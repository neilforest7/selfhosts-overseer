#!/usr/bin/env tsx

/**
 * Backfill script to populate missing composeGroupKey and composeFolderName fields
 * for existing Compose-managed containers in the database.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillComposeMetadata() {
  console.log('🔍 Starting backfill of Compose metadata fields...');

  try {
    // Find all Compose-managed containers missing composeGroupKey or composeFolderName
    const containersToUpdate = await prisma.container.findMany({
      where: {
        isComposeManaged: true,
        composeProject: { not: null },
        OR: [
          { composeGroupKey: null },
          { composeFolderName: null },
        ],
      },
      select: {
        id: true,
        hostId: true,
        name: true,
        composeProject: true,
        composeWorkingDir: true,
        composeGroupKey: true,
        composeFolderName: true,
      },
    });

    console.log(`📊 Found ${containersToUpdate.length} containers to update`);

    if (containersToUpdate.length === 0) {
      console.log('✅ No containers need updating. All Compose metadata is complete.');
      return;
    }

    let updatedCount = 0;

    for (const container of containersToUpdate) {
      const updates: any = {};

      // Generate composeGroupKey if missing
      if (!container.composeGroupKey && container.composeProject) {
        updates.composeGroupKey = `${container.hostId}::compose::${container.composeProject}`;
      }

      // Generate composeFolderName if missing
      if (!container.composeFolderName && container.composeProject) {
        if (container.composeWorkingDir) {
          const parts = container.composeWorkingDir.split(/[/\\]+/).filter(Boolean);
          updates.composeFolderName = parts.length > 0 ? parts[parts.length - 1] : container.composeProject;
        } else {
          updates.composeFolderName = container.composeProject;
        }
      }

      // Update the container if we have any updates
      if (Object.keys(updates).length > 0) {
        await prisma.container.update({
          where: { id: container.id },
          data: updates,
        });

        console.log(`✅ Updated container "${container.name}":`, {
          composeGroupKey: updates.composeGroupKey || container.composeGroupKey,
          composeFolderName: updates.composeFolderName || container.composeFolderName,
        });

        updatedCount++;
      }
    }

    console.log(`🎉 Successfully updated ${updatedCount} containers`);

    // Verify the results
    const remainingCount = await prisma.container.count({
      where: {
        isComposeManaged: true,
        composeProject: { not: null },
        OR: [
          { composeGroupKey: null },
          { composeFolderName: null },
        ],
      },
    });

    if (remainingCount === 0) {
      console.log('✅ All Compose-managed containers now have complete metadata!');
    } else {
      console.log(`⚠️  ${remainingCount} containers still missing metadata (may need manual review)`);
    }

  } catch (error) {
    console.error('❌ Error during backfill:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  backfillComposeMetadata()
    .then(() => {
      console.log('🏁 Backfill completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Backfill failed:', error);
      process.exit(1);
    });
}

export { backfillComposeMetadata };
