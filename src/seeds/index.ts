import { seedSocialPlatforms } from './social-platforms.js';

/**
 * Main seeder that runs all seed files
 */
const runSeeders = async () => {
  console.log('🌱 Starting database seeding...\n');

  try {
    // Run all seeders in order
    seedSocialPlatforms();

    console.log('\n✅ All seeders completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error running seeders:', error);
    process.exit(1);
  }
};

// Run seeders if this file is executed directly
if (require.main === module) {
  runSeeders();
}

export { runSeeders };
