// Funny moment generator.
const { Command } = require('commander');
const program = new Command();
const pck = require('./package.json');
const cp = require('child_process');
const fs = require('fs');

program
  .name(pck.name)
  .description(pck.description)
  .version(pck.version);

program.command('go')
  .description('Generate a new clip')
  .argument('<files...>', 'source video files')
  .option('--level [number]', 'silence level, 0 dB to 60 dB', 30)
  .option('--duration [number]', 'silence duration', 0.75)
  .option('--count [number]', 'clip count in compilation', 3)
  .action((files, options) => {
    newCompilation(files, options);
  });

program.parse();

function newCompilation (files, options) {
  process.stdout.write('Started generating new compilation.\n');
  // Creates a new compilation.
  // Generate clips:
  const clips = []; // <- Stores clip files.
  const promises = []; // <- Stores promises for clip creation.
  // Get x number of clips.
  for (let i = 0; i < options.count; i++) {
    // Create a promise that will resolve when clip is ready.
    const promise = new Promise((resolve, reject) => {
      try {
        getClip(files, options, i, resolve);
      } catch (err) {
        reject(err);
      }
      clips.push(`generated_clip_${i}.ts`);
    });
    promises.push(promise);
  }
  Promise.all(promises).then(() => {
    // Concat clips.
    process.stdout.write('Combining clips.\n');
    let concatString = 'concat:';
    for (let i = 0; i < clips.length; i++) {
      concatString += clips[i];
      if (i < clips.length - 1) {
        concatString += '|';
      }
    }
    const ffmpeg1 = cp.exec(`ffmpeg -i "${concatString}" concat.ts`);
    ffmpeg1.on('exit', () => {
      // Delete clips.
      clips.forEach(c => {
        if (fs.existsSync(c)) fs.unlinkSync(c);
      });
      // Re-encode.
      process.stdout.write('Re-encoding.\n');
      const ffmpeg2 = cp.exec('ffmpeg -i concat.ts -r 24 -c:v libx265 -crf 30 -preset slow -c:a aac -b:a 64k clip_compilation.mp4');
      ffmpeg2.on('exit', () => {
        // Delete concat file.
        if (fs.existsSync('concat.ts')) {
          fs.unlinkSync('concat.ts');
        }
        process.stdout.write('Done.\n');
        process.exit();
      });
    });
  });
}

function getClip (files, options, i, resolve) {
  process.stdout.write(`Creating clip ${i}.\n`);
  // Choose random file.
  const randomFile = files[Math.floor(Math.random() * files.length)];
  // Extract silences.
  const ffmpeg1 = cp.exec(`ffmpeg -i ${randomFile} -af silencedetect=n=-${options.level}dB:d=${options.duration} -f null - 2>&1 | findstr /c:"silence_end" > silences_${i}`);
  process.stdout.write(`Detecting silences for clip ${i}.\n`);
  ffmpeg1.on('exit', () => {
    // Read silences.
    process.stdout.write(`Parsing silences for clip ${i}.\n`);
    const silences = fs.readFileSync(`silences_${i}`, 'utf-8').replace(/\r\n/g, '\n').split('\n');
    // Choose random silence, not the last one.
    const rand = Math.floor(Math.random() * (silences.length - 2));
    const randomSilence = silences[rand]; // This is the end of a silence.
    const next = silences[rand + 1]; // This is the end of the next silence.
    // Parse silence.
    const str1 = 'silence_end: ';
    const str2 = 'silence_duration: ';

    let startTime = randomSilence.substring(randomSilence.indexOf(str1) + str1.length);
    startTime = parseFloat(startTime.substring(0, startTime.indexOf(' '))) - 0.2;

    let nextSilenceEnd = next.substring(next.indexOf(str1) + str1.length);
    nextSilenceEnd = parseFloat(nextSilenceEnd.substring(0, nextSilenceEnd.indexOf(' ')));

    const nextSilenceDuration = next.substring(next.indexOf(str2) + str2.length);

    const duration = nextSilenceEnd - nextSilenceDuration - startTime + 0.5;

    process.stdout.write(`Extracting clip ${i}.\n`);
    // Desired section of video has been selected, trim from video.
    fs.unlinkSync(`silences_${i}`);
    const ffmpeg2 = cp.exec(`ffmpeg -i ${randomFile} -vf scale=-1:720 -ss ${startTime} -t ${duration} generated_clip_${i}.ts`);
    ffmpeg2.on('exit', () => {
      // Operation complete, resolve promise.
      resolve();
    });
  });
}
