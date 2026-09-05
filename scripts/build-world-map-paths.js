// Turns the country-borders GeoJSON into a small, ready-to-draw SVG path
// file for the public site's reader map.
//
//   node scripts/build-world-map-paths.js
//
// WHY PRE-RENDER. src/assets/world-countries.geo.json is 440 kB, and the
// admin's Leaflet map fetches and parses it at runtime, which is fine on a
// back-office screen someone opened on purpose. The public Discipleship
// Library page is not that: every visitor would pay for it. This flattens the
// geometry to SVG path data once, here, and the page ships a file a fraction
// of the size with no parsing beyond JSON.parse.
//
// THE PROJECTION IS EQUIRECTANGULAR - x from longitude, y from latitude, both
// linear. It stretches the far north badly (Greenland looks enormous) and any
// world map has to be wrong about something. It is chosen because plotting a
// point on it is two multiplications with no library, so the page's dots and
// its coastlines cannot disagree about where a coordinate is - which is the
// one error a reader map would actually notice.
//
// Antarctica is dropped: it fills the bottom eighth of an equirectangular
// frame, has no readers, and cropping the frame above it makes every
// inhabited place bigger.

const fs = require('fs');
const path = require('path');

/** The viewBox this writes into. Whole numbers keep the file small. */
const WIDTH = 1000;
const HEIGHT = 500;

/** Latitudes outside this are cut - see the note about Antarctica. The top
 *  is kept generous so northern Canada and Scandinavia stay whole. */
const LAT_TOP = 84;
const LAT_BOTTOM = -56;

/** Rings whose bounding box is smaller than this, in projected units, are
 *  dropped. At 1000x500 a unit is about a third of a millimetre on screen;
 *  what goes are uninhabited islets, several thousand of them. */
const MIN_RING_SIZE = 1.2;

/** How far apart two kept points must be, in projected units. Under a
 *  pixel at this scale. */
const MIN_STEP = 0.9;

/** Coordinate precision in the output. One decimal at this scale is a tenth
 *  of a pixel - invisible, and it roughly halves the file. */
const PRECISION = 1;

/**
 * Projects a longitude/latitude pair into the viewBox.
 * @param {number} lng Degrees east.
 * @param {number} lat Degrees north.
 * @return {[number, number]} x and y in viewBox units.
 */
function project(lng, lat) {
  const x = ((lng + 180) / 360) * WIDTH;
  const y = ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * HEIGHT;
  return [x, y];
}

/**
 * One ring of a polygon as an SVG subpath, or '' if it is too small to see.
 * @param {Array} ring GeoJSON positions.
 * @return {string} Path data, or an empty string.
 */
function ringToPath(ring) {
  const pts = [];
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  let last = null;

  for (const [lng, lat] of ring) {
    const [x0, y0] = project(lng, lat);
    const x = Number(x0.toFixed(PRECISION));
    const y = Number(y0.toFixed(PRECISION));
    // Consecutive near-duplicates survive rounding in their thousands and
    // draw nothing you can see. Dropping any point within MIN_STEP of the
    // last kept one is most of the size win, and at this scale MIN_STEP is
    // under a pixel - a coastline loses wiggles no visitor could resolve.
    //
    // The LAST point of a ring is never dropped this way (see below), or a
    // country can fail to close and bleed fill across the map.
    if (last &&
        Math.abs(last[0] - x) < MIN_STEP && Math.abs(last[1] - y) < MIN_STEP) {
      continue;
    }
    last = [x, y];
    pts.push([x, y]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // A ring that lost its closing point to MIN_STEP would be filled by the
  // renderer as if the gap were a straight edge across the country. 'Z' does
  // close the subpath, so this is belt to that braces - but the belt costs
  // one point per country and a wrong one costs a smear across the map.
  const [lastLng, lastLat] = ring[ring.length - 1];
  const [lx, ly] = project(lastLng, lastLat);
  const closeX = Number(lx.toFixed(PRECISION));
  const closeY = Number(ly.toFixed(PRECISION));
  if (pts.length && (pts[0][0] !== closeX || pts[0][1] !== closeY)) {
    const tail = pts[pts.length - 1];
    if (tail[0] !== closeX || tail[1] !== closeY) {
      pts.push([closeX, closeY]);
    }
  }

  if (pts.length < 3) {
    return '';
  }
  if (maxX - minX < MIN_RING_SIZE && maxY - minY < MIN_RING_SIZE) {
    return '';
  }
  return 'M' + pts.map(([x, y]) => `${x} ${y}`).join('L') + 'Z';
}

function main() {
  const src = path.join(__dirname, '..', 'src', 'assets', 'world-countries.geo.json');
  const geo = JSON.parse(fs.readFileSync(src, 'utf8'));

  const paths = [];
  let dropped = 0;

  for (const feature of geo.features || []) {
    const name = feature.properties?.name || feature.properties?.NAME || '';
    if (/antarctic/i.test(name)) {
      continue;
    }
    const geom = feature.geometry;
    if (!geom) {
      continue;
    }
    const polygons = geom.type === 'Polygon' ? [geom.coordinates] :
      geom.type === 'MultiPolygon' ? geom.coordinates : [];

    const parts = [];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const d = ringToPath(ring);
        if (d) {
          parts.push(d);
        } else {
          dropped++;
        }
      }
    }
    if (parts.length) {
      paths.push(parts.join(''));
    }
  }

  const out = {
    width: WIDTH,
    height: HEIGHT,
    latTop: LAT_TOP,
    latBottom: LAT_BOTTOM,
    paths
  };
  const json = JSON.stringify(out);

  const dest = path.join(
    __dirname, '..', '..', 'impactdisciples - web',
    'src', 'assets', 'world-map-paths.json');
  fs.writeFileSync(dest, json);

  const before = fs.statSync(src).size;
  console.log(`${paths.length} countries, ${dropped} tiny rings dropped`);
  console.log(`${(before / 1024).toFixed(0)} kB GeoJSON -> ` +
    `${(json.length / 1024).toFixed(0)} kB of path data`);
  console.log(dest);
}

main();
