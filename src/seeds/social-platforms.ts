import db, { generateUUID } from '../db.js';

interface SocialPlatformSeed {
  slug: string;
  name: string;
  word_limit: number | null;
}

// Define social platforms to seed
const socialPlatforms: SocialPlatformSeed[] = [
  {
    slug: 'x',
    name: 'X',
    word_limit: 280,
  },
  // Add more platforms here as needed
  // {
  //   slug: 'linkedin',
  //   name: 'LinkedIn',
  //   word_limit: 3000,
  // },
  // {
  //   slug: 'threads',
  //   name: 'Threads',
  //   word_limit: 500,
  // },
];

/**
 * Seeds social platforms into the database
 */
export const seedSocialPlatforms = () => {
  console.log('🌱 Seeding social platforms...');

  const insert = db.prepare(`
    INSERT OR IGNORE INTO social_platforms (id, slug, name, word_limit, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  let insertedCount = 0;
  let skippedCount = 0;

  for (const platform of socialPlatforms) {
    const result = insert.run(
      generateUUID(),
      platform.slug,
      platform.name,
      platform.word_limit
    );

    if (result.changes > 0) {
      console.log(`  ✓ Inserted: ${platform.name} (${platform.slug})`);
      insertedCount++;
    } else {
      console.log(`  - Skipped (already exists): ${platform.name} (${platform.slug})`);
      skippedCount++;
    }
  }

  console.log(`\n✨ Seeding complete!`);
  console.log(`   Inserted: ${insertedCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Total: ${socialPlatforms.length}`);
};

// Run seeder if this file is executed directly
if (import.meta.url === new URL(import.meta.url).href) {
  try {
    seedSocialPlatforms();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}
