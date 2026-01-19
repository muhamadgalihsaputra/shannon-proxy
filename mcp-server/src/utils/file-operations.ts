// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * File Operations Utilities
 *
 * Handles file system operations for deliverable saving.
 * Ported from tools/save_deliverable.js (lines 117-130).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Save deliverable file to deliverables/ directory
 *
 * @param targetDir - Target directory for deliverables (passed explicitly to avoid race conditions)
 * @param filename - Name of the deliverable file
 * @param content - File content to save
 */
export function saveDeliverableFile(targetDir: string, filename: string, content: string): string {
  const deliverablesDir = join(targetDir, 'deliverables');
  const filepath = join(deliverablesDir, filename);

  // Debug: Log permission context for troubleshooting Docker volume issues
  console.log(`[save_deliverable] Saving to: ${filepath}`);
  console.log(`[save_deliverable] Process UID: ${process.getuid?.() ?? 'N/A'}, GID: ${process.getgid?.() ?? 'N/A'}`);

  // Ensure deliverables directory exists
  try {
    mkdirSync(deliverablesDir, { recursive: true });
    console.log(`[save_deliverable] Created/verified directory: ${deliverablesDir}`);
  } catch (mkdirError) {
    const errMsg = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
    // Only throw if it's not "already exists" error
    if (!errMsg.includes('EEXIST')) {
      console.error(`[save_deliverable] Failed to create directory: ${errMsg}`);
      throw new Error(`Cannot create deliverables directory: ${errMsg}. Check Docker volume permissions.`);
    }
  }

  // Write file (atomic write - single operation)
  try {
    writeFileSync(filepath, content, 'utf8');
    console.log(`[save_deliverable] Successfully wrote ${content.length} bytes to ${filename}`);
  } catch (writeError) {
    const errMsg = writeError instanceof Error ? writeError.message : String(writeError);
    console.error(`[save_deliverable] Failed to write file: ${errMsg}`);
    throw new Error(`Cannot write deliverable file: ${errMsg}. Check Docker volume permissions (UID mismatch?).`);
  }

  return filepath;
}
