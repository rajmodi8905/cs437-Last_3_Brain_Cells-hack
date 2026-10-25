// Regeneration requires macOS `say`, ffmpeg and npm dependencies. Fixtures are synthetic, not campus facts.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
await mkdir('tests/fixtures', { recursive: true });
const root = 'tests/fixtures/';
const records = [];
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="660" viewBox="0 0 900 660">${body}</svg>`;
async function image(name, body, format = 'png') {
  await sharp(Buffer.from(svg(body)))
    .toFormat(format)
    .toFile(root + name);
}
const backdrop = '<rect width="900" height="660" fill="#f1eee5"/>';
const bike =
  '<g fill="none" stroke="#263e51" stroke-width="12"><circle cx="340" cy="490" r="83"/><circle cx="630" cy="490" r="83"/><path d="M340 490l94-155 90 155H340l85-145m99 145 70-210m-22 0h60m-239 52h75"/></g>';
const hoop =
  '<rect x="680" y="60" width="150" height="95" fill="white" stroke="#929ca4" stroke-width="7"/><path d="M755 155V530" stroke="#777" stroke-width="14"/><ellipse cx="710" cy="163" rx="48" ry="12" fill="none" stroke="#d87033" stroke-width="9"/><path d="M665 166l15 55h60l15-55M683 171l10 47m24-47-10 47" fill="none" stroke="white" stroke-width="4"/>';
const umbrella =
  '<path d="M120 230q140-240 280 0Z" fill="#f1c830" stroke="#b5931d" stroke-width="6"/><path d="M260 210v260q0 48 45 24" fill="none" stroke="#756641" stroke-width="9"/>';
const backpack =
  '<rect x="90" y="415" width="720" height="40" fill="#a88055"/><path d="M150 455v180m600-180v180" stroke="#73563d" stroke-width="25"/><g stroke="#8d3030" stroke-width="8"><path d="M335 390V205q0-90 115-90t115 90v185Z" fill="#ce4141"/><rect x="363" y="260" width="174" height="118" rx="22" fill="#b83434"/><path d="M390 130v-35q60-45 120 0v35" fill="none"/><path d="M345 170q-70 60-30 200m240-200q70 60 30 200" fill="none"/></g>';
async function poster(name, title, lines, format) {
  await image(
    name,
    `<rect width="900" height="660" fill="#fffdf7"/><rect x="45" y="45" width="810" height="570" fill="none" stroke="#203e58" stroke-width="7"/><text x="90" y="145" font-family="Arial" font-weight="bold" font-size="43" fill="#203e58">${escape(title)}</text>${lines.map((s, i) => `<text x="90" y="${245 + i * 70}" font-family="Arial" font-size="32" fill="#283a49">${escape(s)}</text>`).join('')}`,
    format,
  );
}
function pdf(name, pages, jpeg) {
  const objects = [];
  const add = (s) => {
    objects.push(s);
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (let i = 0; i < pages.length; i++) {
    const content = jpeg
      ? 'q 500 0 0 367 45 400 cm /Im0 Do Q'
      : `BT /F1 17 Tf 50 750 Td ${pages[i].map((line, j) => `${j ? '0 -32 Td ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')} ET`;
    const stream = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
    let imageId;
    if (jpeg)
      imageId = add(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width 900 /Height 660 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
          ),
          jpeg,
          Buffer.from('\nendstream'),
        ]),
      );
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> ${imageId ? `/XObject << /Im0 ${imageId} 0 R >>` : ''} >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let output = Buffer.from('%PDF-1.4\n');
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(output.length);
    output = Buffer.concat([
      output,
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from('\nendobj\n'),
    ]);
  });
  const xref = output.length;
  output = Buffer.concat([
    output,
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
    ),
  ]);
  return writeFile(root + name, output);
}
function ff(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}
function speech(name, text, format = 'mp3') {
  execFileSync('say', ['-v', 'Samantha', '-r', '145', '-o', '/tmp/campus-fixture.aiff', text]);
  ff([
    '-i',
    '/tmp/campus-fixture.aiff',
    ...(format === 'm4a' ? ['-c:a', 'aac'] : ['-c:a', 'libmp3lame']),
    root + name,
  ]);
}
await poster(
  'sample-01.jpg',
  'BADMINTON TEAM TRYOUTS',
  [
    'Synthetic campus announcement',
    'Register by Friday, 5 PM',
    'Bring your racket to the sports hall.',
  ],
  'jpeg',
);
await poster(
  'sample-02.png',
  'CS437 PROJECT SUBMISSION',
  ['Synthetic course notice', 'Hand in the report on 5 November', 'Submit before 6 PM.'],
  'png',
);
await pdf('sample-03.pdf', [
  ['Synthetic CS437 project guidelines', 'Read the rules on the next page.'],
  ['CS437 project rules', 'A project group may contain at most three students.'],
  ['Keep a record of contributions.'],
]);
await pdf('sample-06.pdf', [
  ['Synthetic committee instructions', 'Procedures continue on the next page.'],
  ['Written objections must arrive within seven calendar days.'],
]);
await image('sample-07.png', backdrop + backpack);
await image(
  'sample-08.png',
  '<rect width="900" height="660" fill="#c6d8df"/><rect y="270" width="900" height="390" fill="#cfa77b"/><path d="M20 560h850M80 300v350" stroke="white" stroke-width="5"/>' +
    hoop +
    bike,
);
speech(
  'sample-09.mp3',
  'This is a synthetic campus announcement. Chess club orientation will be held on Saturday afternoon in the student activity centre. All beginners are welcome.',
);
speech(
  'sample-10.m4a',
  'This is a synthetic laboratory instruction. Collect your laboratory access card from the electronics office on Monday morning. Bring your student identity card.',
  'm4a',
);
speech(
  'video-speech.m4a',
  'This is a synthetic rehearsal notice. The theatre rehearsal will take place in the black box studio near the auditorium. Please arrive before six in the evening.',
  'm4a',
);
ff([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x46515c:s=640x360:r=10:d=22',
  '-i',
  root + 'video-speech.m4a',
  '-vf',
  'format=yuv420p',
  '-af',
  'adelay=3000|3000',
  '-c:v',
  'libx264',
  '-c:a',
  'aac',
  '-shortest',
  root + 'sample-11.mp4',
]);
await image('scene.png', backdrop + umbrella + bike);
ff([
  '-loop',
  '1',
  '-i',
  root + 'scene.png',
  '-t',
  '7',
  '-r',
  '5',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-an',
  root + 'sample-12.mp4',
]);
const targets = [
  { id: 'R1', file: 'sample-01.jpg', query: 'Find the badminton team registration announcement' },
  { id: 'R2', file: 'sample-02.png', query: 'When do we hand in the CS437 project?' },
  {
    id: 'R3',
    file: 'sample-03.pdf',
    query: 'How many classmates can work together for CS437?',
    page: 2,
  },
  {
    id: 'R4',
    kind: 'note',
    text: 'Meet the mentor at the north library entrance on Tuesday afternoon.',
    query: 'Where is our adviser appointment?',
  },
  {
    id: 'R5',
    kind: 'webpage',
    url: 'https://example.test/fixture/05',
    text: 'Build a robot at the student workshop. Registration opens on Thursday. Fill in the application to reserve your place.',
    query: 'Find the sign-up page for the robot-building session',
  },
  { id: 'R6', file: 'sample-06.pdf', query: 'How long is the appeal window?', page: 2 },
  { id: 'R7', file: 'sample-07.png', query: 'Find the red backpack on the table', visual: true },
  {
    id: 'R8',
    file: 'sample-08.png',
    query: 'Find the bicycle beside the basketball court',
    visual: true,
  },
  {
    id: 'R9',
    file: 'sample-09.mp3',
    query: 'Find the voice announcement about the chess orientation',
    interval: [0, 18],
  },
  {
    id: 'R10',
    file: 'sample-10.m4a',
    query: 'Where was the recording about collecting the lab access card?',
    interval: [0, 18],
  },
  {
    id: 'R11',
    file: 'sample-11.mp4',
    query: 'Find the video explaining where theatre rehearsal is',
    interval: [3, 21],
  },
  {
    id: 'R12',
    file: 'sample-12.mp4',
    query: 'Find the video with a yellow umbrella next to a bicycle',
    visual: true,
    interval: [0, 7],
  },
];
const distractors = [
  'Football trials registration closes next Tuesday. Bring boots.',
  'CS201 homework submission is due next Monday at noon.',
  'The chemistry group assignment allows five students per team.',
  'Meet the finance tutor at the south cafeteria on Friday.',
  'Painting workshop materials are available in the studio.',
  'A committee review meeting will happen this Wednesday.',
  'The library opens at eight on weekdays and nine on weekends.',
  'Music practice rooms can be booked through the activity office.',
  'The cafeteria serves lunch between twelve and two.',
  'Return borrowed sports equipment to the front desk.',
  'A green notebook was left on a classroom seat.',
  'Photography club is organizing a portrait session outdoors.',
  'The shuttle departs from the main gate at ten.',
  'Bring your ticket to the film screening in the auditorium.',
  'Submit the mathematics quiz independently.',
  'The computer lab will be closed for maintenance on Sunday.',
  'Volunteers should collect blue event badges at reception.',
  'Water dispensers are available on each hostel floor.',
].map((text, i) => ({ id: `D${i + 1}`, kind: 'note', text }));
await image(
  'sample-23.png',
  '<rect width="900" height="660" fill="#cce3ef"/><circle cx="450" cy="310" r="140" fill="#3b78a8"/>',
);
await image(
  'sample-24.png',
  '<rect width="900" height="660" fill="#ebd8bb"/><rect x="300" y="210" width="320" height="220" fill="#49844c"/>',
);
await image(
  'sample-25.png',
  '<rect width="900" height="660" fill="#ebf2dd"/><path d="M230 500l220-350 220 350Z" fill="#e78351"/>',
);
await pdf('sample-26.pdf', [
  ['Synthetic transport notice', 'The shuttle departs from the main gate at ten.'],
]);
await pdf('sample-27.pdf', [
  ['Synthetic maintenance notice', 'The computer lab will be closed on Sunday.'],
]);
speech(
  'sample-28.mp3',
  'This is a synthetic dining announcement. Lunch is served from twelve until two at the cafeteria.',
);
speech(
  'sample-29.mp3',
  'This is a synthetic sports notice. Return borrowed footballs and cones to the equipment desk.',
);
ff([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x5f7d57:s=640x360:r=5:d=6',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-an',
  root + 'sample-30.mp4',
]);
for (let i = 10; i < 18; i++)
  distractors[i] = {
    id: `D${i + 1}`,
    file: `sample-${i + 13}.${i < 13 ? 'png' : i < 15 ? 'pdf' : i < 17 ? 'mp3' : 'mp4'}`,
  };
await image(
  'cal-ball.png',
  backdrop +
    '<circle cx="450" cy="330" r="150" fill="white" stroke="#293948" stroke-width="8"/><path d="M390 290l60-45 65 45-25 80h-75Z" fill="#263744"/><path d="M300 325l90-35m125 0 85 35m-185 45-60 80m135-80 55 80" stroke="#263744" stroke-width="17"/>',
);
await image(
  'cal-flower.png',
  backdrop +
    '<path d="M450 340v280m0-120q-150-20-170-120 160 0 170 120m0 50q150-10 170-100-160 0-170 100" fill="#4c8154" stroke="#4c8154" stroke-width="14"/><g fill="#efba29">' +
    Array.from(
      { length: 10 },
      (_, i) =>
        `<ellipse cx="450" cy="200" rx="45" ry="110" transform="rotate(${i * 36} 450 310)"/>`,
    ).join('') +
    '<circle cx="450" cy="310" r="95" fill="#6a4726"/></g>',
);
await image(
  'cal-chair.png',
  backdrop +
    '<g fill="#36699d" stroke="#285179" stroke-width="16"><rect x="320" y="100" width="260" height="240"/><rect x="280" y="340" width="340" height="60"/><path d="M310 400v210m280-210v210"/></g>',
);
for (const item of [...targets, ...distractors])
  if (item.file)
    item.sha256 = createHash('sha256')
      .update(await readFile(root + item.file))
      .digest('hex');
await writeFile(
  root + 'corpus.json',
  JSON.stringify(
    {
      provenance:
        'Team-created synthetic fixtures. Drawings rendered from SVG; speech synthesized using macOS Samantha. No actual announcements or interview artifacts.',
      targets,
      distractors,
      negatives: [
        "Find the instructions for replacing a car's alternator.",
        'Find the sourdough bread recipe I saved.',
        'Show the hotel reservation for my Paris holiday.',
      ],
    },
    null,
    2,
  ) + '\n',
);
// Independent scanned PDF and calibration fixtures are outside the 30-item held-out corpus.
await pdf('scanned.pdf', [[]], await readFile(root + 'sample-01.jpg'));
await poster('calibration.png', 'VOLUNTEER DESK', ['Help distribute books at reception.'], 'png');
await writeFile(
  root + 'calibration-starter.json',
  JSON.stringify(
    {
      visuals: [
        { file: 'cal-ball.png', query: 'A black and white soccer ball' },
        { file: 'cal-flower.png', query: 'A sunflower with a green stem' },
        { file: 'cal-chair.png', query: 'A blue chair' },
      ],
      texts: [
        {
          text: 'Collect the field trip permission slip from the geography department office.',
          query: 'Where do I pick up the excursion authorization form?',
        },
        {
          text: 'The swimming pool closes at eight in the evening.',
          query: 'When does the pool shut?',
        },
        {
          text: 'Dormitory residents must return room keys to the housing counter.',
          query: 'Where should residents hand back their keys?',
        },
      ],
      negatives: [
        'How do I repair a diesel tractor?',
        'Show the ski lift ticket for the Swiss Alps.',
        'Find my recipe for chocolate souffle.',
      ],
    },
    null,
    2,
  ) + '\n',
);
console.log('Created synthetic corpus and independent extraction/calibration fixtures.');
