import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const outputDir = path.resolve(process.cwd(), 'sample-photos-test');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function createSampleImage(filename, width, height, color, options = {}) {
  const filePath = path.join(outputDir, filename);
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  });

  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    if (options.exifRotate) {
      // simulate orientation metadata
      pipeline = pipeline.withMetadata({ orientation: 6 });
    }
    await pipeline.jpeg().toFile(filePath);
  } else if (ext === '.png') {
    await pipeline.png().toFile(filePath);
  } else if (ext === '.webp') {
    await pipeline.webp().toFile(filePath);
  } else {
    fs.writeFileSync(filePath, 'dummy content');
  }
}

async function generateAll() {
  console.log('Generating 20 sample test images in:', outputDir);

  // 1-5: Matching student records (using sample roll numbers)
  await createSampleImage('2420101.jpg', 600, 600, { r: 244, g: 196, b: 48 });
  await createSampleImage('2420102.png', 500, 500, { r: 50, g: 150, b: 250 });
  await createSampleImage('2420103.webp', 450, 450, { r: 100, g: 200, b: 100 });
  await createSampleImage('2420104.jpeg', 800, 800, { r: 200, g: 100, b: 200 });
  await createSampleImage('uu21005.jpg', 600, 600, { r: 220, g: 180, b: 60 });

  // 6-8: Formatting edge cases
  await createSampleImage(' 2420106 .jpg', 500, 500, { r: 180, g: 70, b: 90 });
  await createSampleImage('lowercase_roll_2420107.jpg', 500, 500, { r: 70, g: 180, b: 220 });
  await createSampleImage('2420108.PNG', 600, 600, { r: 90, g: 90, b: 180 });

  // 9-10: Duplicate mapping to student 2420101
  await createSampleImage('DUPLICATE_2420101.jpg', 600, 600, { r: 255, g: 50, b: 50 });
  await createSampleImage('extra_2420102.png', 500, 500, { r: 255, g: 100, b: 100 });

  // 11-13: Unmatched files
  await createSampleImage('UNKNOWN_99901.jpg', 500, 500, { r: 150, g: 150, b: 150 });
  await createSampleImage('NOTFOUND_88802.png', 500, 500, { r: 120, g: 120, b: 120 });
  await createSampleImage('GHOST_77703.webp', 500, 500, { r: 100, g: 100, b: 100 });

  // 14: Tiny image
  await createSampleImage('2420109_tiny.jpg', 16, 16, { r: 255, g: 255, b: 255 });

  // 15: Large image (2400 x 2400)
  await createSampleImage('2420110_huge.jpg', 2400, 2400, { r: 250, g: 200, b: 150 });

  // 16: Aspect ratio non-square (wide 1200 x 600)
  await createSampleImage('2420111_wide.jpg', 1200, 600, { r: 140, g: 220, b: 180 });

  // 17: Aspect ratio non-square (tall 600 x 1200)
  await createSampleImage('2420112_tall.jpg', 600, 1200, { r: 180, g: 140, b: 220 });

  // 18: Rotated EXIF image
  await createSampleImage('2420113_rotated.jpg', 800, 600, { r: 244, g: 196, b: 48 }, { exifRotate: true });

  // 19: Unsupported HEIC file (dummy)
  fs.writeFileSync(path.join(outputDir, '2420114.heic'), 'Fake HEIC header data');

  // 20: Non-image file
  fs.writeFileSync(path.join(outputDir, 'student_list.txt'), 'Not an image');

  console.log('Successfully created 20 test files in sample-photos-test!');
}

generateAll().catch(console.error);
