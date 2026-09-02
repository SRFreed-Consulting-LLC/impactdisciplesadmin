#!/usr/bin/env node
// Moves the Coaching with Impact page's content out of the web app's code and
// into data, so staff can change it without a deploy.
//
// The page was rebuilt from a WordPress export on 2026-08-23 with everything
// hardcoded in CoachingWithImpactComponent. This writes two things:
//
//   1. Seven testimonials into `testimonials`, typed 'Coaching with Impact',
//      taken VERBATIM from that component. They are real people's words - the
//      text is copied, never rewritten or trimmed.
//   2. `coaching_page/current`, carrying the video id, those seven ids in the
//      page's current order, and the four screenshots.
//
// PARAGRAPHS. TestimonialModel.text is one string, but three of these quotes
// run to two or three paragraphs. They are joined with a BLANK LINE, which is
// what the web page splits on (toCoachTestimonial) and what the admin screen
// preserves. Flattening them would turn a considered testimonial into a wall.
//
// IDEMPOTENT. Each testimonial gets a fixed, obviously-derived id, so a second
// run updates the same seven documents instead of making seven more. Re-running
// is safe and is how you push a correction.
//
// Usage:
//   node scripts/seed-coaching-page.js --project=dev            (dry run)
//   node scripts/seed-coaching-page.js --project=dev --execute
//   node scripts/seed-coaching-page.js --project=prod --execute
"use strict";

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");
const { tenantCollection } = require("./lib/tenancy");

const TYPE = "Coaching with Impact";
const PAGE_DOC = "current";
const PAGE_COLLECTION = "coaching_page";

const BUCKET =
  "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o";

const VIDEO_ID = "krHPH7SoQwU";
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

const SCREENSHOTS = [
  "Coaching-With-Impact%2FScreenshot%202025-01-06%20at%208.27.18%20AM.PNG?alt=media&token=db721517-b361-4509-bb6f-b88d51d51cd0",
  "Coaching-With-Impact%2FScreenshot%202025-01-06%20at%208.31.57%20AM.PNG?alt=media&token=819ea4e6-4911-40e8-bc41-84f59aa71073",
  "Coaching-With-Impact%2FScreenshot%202025-01-06%20at%208.32.05%20AM.PNG?alt=media&token=f4d7a657-e466-4834-8b2d-b949345916f4",
  "Coaching-With-Impact%2FScreenshot%202025-01-06%20at%208.32.14%20AM.PNG?alt=media&token=aa7ba169-93da-48c3-9a88-111993d0a2a3",
];

// Verbatim from coaching-with-impact.component.ts. `paragraphs` mirrors that
// component's `quote: string[]`; order here is the order the page shows them.
const TESTIMONIALS = [
  {
    id: "cwi-franklin-deloach",
    author: "Franklin DeLoach",
    title: "Head Baseball and Softball Coach, East Coweta High School",
    paragraphs: [
      'Going through "Coaching with Impact" these past two years have been life changing and a true blessing. Meeting with my brothers in Christ; Kevin Burrell, John Small, Cam Smith, and Mark Bowles has really helped my growth and spiritual maturity in Christ. The sincerity that we each brought while working through the "Coaching with Impact" book has been priceless. Being and Building disciples of Christ, while exercising the character and conduct of Christ has been life changing for all of us. I know with certainty that this venture has helped my growth with the fruits of the spirit of love, joy, peace, patience, kindness, goodness, faithfulness, gentleness, and self control. "GO, and make disciples of all nations, baptizing them in the name of the Father, Son, and Holy Spirit."',
    ],
  },
  {
    id: "cwi-john-small",
    author: "John Small",
    title: "Head Football Coach, East Coweta High School",
    paragraphs: [
      "The Coaching with Impact study, led by Kevin Burrell had a profound impact on me as a person and a Coach. I learned about the Character and Conduct of Jesus. Learning how Jesus led, influenced others, and prioritized building relationships was eye opening to me. I thought I did it well, but wow, had I fallen short. This study has both encouraged and challenged me to go beyond what I was doing as a Christian Coach. Understanding now the Great Commandment and Great Commission, and what we are called to be and do daily as a Coach who is called to build the Kingdom!",
    ],
  },
  {
    id: "cwi-mark-bowles",
    author: "Mark Bowles",
    title: "Baseball and Softball Coach, East Coweta High School",
    paragraphs: [
      'There are two questions that I repeatedly would ask myself as I was going through the "Coaching with Impact" discipleship training. Am I leveraging my influence in a way that is producing disciples? Are the fruits of the Spirit on display in my life? We are called to Be and Build disciples of Jesus Christ, and as a coach, we have a platform and arena where we have the ability to leverage our influence to reach others for Jesus by developing relationships!',
      'I often find myself in situations where the days run long, things may not go as planned and the overall season is just a grind. These are the moments where "Coaching with Impact" has instilled in me the importance of seeking to live out the fruits of the Spirit in a way that others can see a difference in my life through the Character and Conduct of Jesus. This "Coaching with Impact" small group has taught me the importance of accountability, progress not perfection, and being fully trained in order to train and lead others!',
      'Two statements that stick with me are, "We are disciple-makers disguised as coaches" and "One day when I stand before Jesus He will not ask me how many games I won, but surely He will ask me if I was Being and Building disciples with my life."',
    ],
  },
  {
    id: "cwi-cam-smith",
    author: "Cam Smith",
    title: "Math Teacher | Asst. Baseball Coach, East Coweta High School",
    paragraphs: [
      'The "Coaching with Impact" study changed the way I look at discipleship and disciple-making. Really, it changed how I view my relationship with God and my mission in life. "Coaching with Impact" taught me about the mission God wants me to have and that is to "Be and Build Disciples" with my life. This mission was once thought by me as "just a missionary\'s job," however this couldn\'t be farther from the truth.',
      "Not only did my life mission change, but this study and this group of coaches helped me with tangible ways on how to Be a disciple and how to Build others to become fully trained disciples. This group equip me about the importance of living out the Character and Conduct of Christ as a coach, and to lead and multiply others through the same process. It was incredibly important to have guys who were set on the same mission as me, and to hold me accountable. This pushed me to hold the others accountable and something that will continue for the rest of my life.",
    ],
  },
  {
    id: "cwi-echs-coach",
    author: "East Coweta High School Coach",
    title: "",
    paragraphs: [
      "I am very thankful for this Coaching with Impact group and the opportunity to dive into God's Word with all the coaches. I appreciate your teaching, guidance and acceptance you have shown me. I don't mean to overshare in the group, but I just feel really comfortable with you all and trust you guys. This group has been extremely helpful for me personally, and is teaching me what it means to be a disciple and how to make disciples. I have never heard or been taught anything like this before. Thank you!",
    ],
  },
  {
    id: "cwi-matt-hopkins",
    author: "Matt Hopkins",
    title: "Head Baseball Coach, Houston County HS — Warner Robins, GA",
    paragraphs: [
      'Coaching is a very rewarding profession, but it can also be very stressful. For years it was easy to lose focus on what the main goal of coaching was, resulting in stress and losing my joy. Part of my staff and I did a weekly discipleship study using the "Coaching with Impact" book and it completely changed my perspective on the game. I could feel a shift from stress to peace as I remembered the "fruit of the spirit" and exemplifying the conduct of Christ on the field as a head coach. The true objective we have as Christian coaches. To this day I am able to calm myself in the heat of the moment by reminding myself the game is not where my joy comes from. I recommend this book for any Christian or non-Christian coaching staff. It will truly help lead you and impact your program for the better.',
    ],
  },
  {
    id: "cwi-tom-griffin",
    author: "Tom Griffin",
    title: "Head Baseball Coach, Carson Newman University",
    paragraphs: [
      "The small group discipleship I have been a part of has been a huge part of my spiritual growth. Being in consistent community has helped strengthened my faith, kept me accountable, and reminded me that I'm not meant to walk this journey alone.",
      "Learning alongside others, praying together, and having people speak truth into my life has strengthened both my relationship with Christ and how I live it out daily. I have learned also that this journey in life, and the problems I face, are the same problems and issues others face. I am not alone!",
      'Our group met once a week for 10 weeks in the fall of 2025 using the book "Coaching with Impact" by Ken Adams. The book has been a great resource to guide our group and lead us in discipleship discussions each week. We are now meeting twice a month to connect and check in on each other.',
    ],
  },
];

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const execute = !!args.execute;
  const projectId = resolveProjectId(String(args.project || "dev"));
  const db = getFirestoreFor(projectId);

  console.log(`project : ${projectId}`);
  console.log(`mode    : ${execute ? "EXECUTE" : "dry run"}\n`);

  // ---------------------------------------------------------- testimonials
  console.log(`testimonials (${TESTIMONIALS.length}, type "${TYPE}"):`);
  for (const t of TESTIMONIALS) {
    const ref = tenantCollection(db, "testimonials").doc(t.id);
    const existing = await ref.get();
    const text = t.paragraphs.join("\n\n");

    console.log(
      `  ${existing.exists ? "update" : "create"}  ${t.id.padEnd(24)} ` +
        `${t.author} (${t.paragraphs.length} para, ${text.length} chars)`
    );

    if (execute) {
      // A re-run must not reset isActive or date if a human has changed them,
      // so those are only written when the document is new.
      const payload = {
        author: t.author,
        title: t.title,
        text,
        type: TYPE,
        ...(existing.exists ? {} : { isActive: true, date: new Date() }),
      };
      await ref.set(payload, { merge: true });
    }
  }

  // ------------------------------------------------------------- page doc
  const pageRef = db.collection(PAGE_COLLECTION).doc(PAGE_DOC);
  const pageSnap = await pageRef.get();

  const page = {
    videoUrl: VIDEO_URL,
    videoId: VIDEO_ID,
    testimonialIds: TESTIMONIALS.map((t) => t.id),
    screenshots: SCREENSHOTS.map((path, i) => ({
      image: { name: decodeURIComponent(path.split("?")[0].split("%2F").pop()), url: `${BUCKET}/${path}` },
      order: i,
      isActive: true,
    })),
  };

  console.log(`\n${PAGE_COLLECTION}/${PAGE_DOC}: ${pageSnap.exists ? "EXISTS" : "new"}`);
  console.log(`  video       : ${page.videoId}`);
  console.log(`  testimonials: ${page.testimonialIds.length} (${page.testimonialIds.join(", ")})`);
  console.log(`  screenshots : ${page.screenshots.length}`);

  if (pageSnap.exists && !args.force) {
    console.log(
      "\n  REFUSING to overwrite the page document - someone has saved this screen.\n" +
        "  The testimonials above are still written (they are idempotent).\n" +
        "  Re-run with --force to replace the page config too."
    );
  } else if (execute) {
    await pageRef.set(page, { merge: false });
    console.log("  written.");
  }

  if (!execute) {
    console.log("\nDry run - nothing written. Re-run with --execute.");
  }
}

main().catch((err) => {
  console.error("seed-coaching-page failed:", err.message);
  process.exit(1);
});
