// The IITGN campus pack: notes built into the app that a student can add to their library with
// one tap. They are saved through the normal local save, so they are indexed, searched, opened,
// exported and deleted like any note. Nothing is fetched: the text below ships with the app.
// Every fact was checked on the official page named in its note. Pages that change each
// semester (seating plans, timetables, mess menus) are not published there, so the pack says
// where they come from instead of guessing them.
import type { LibraryItem } from '../shared';
import type { CampusRecallServices } from './services';

export interface CampusPackNote {
  /** Stable across releases: it records which notes were saved, so a deleted one stays deleted. */
  key: string;
  title: string;
  text: string;
}

export const CAMPUS_PACK_PREFERENCE = 'campus-pack';
export const CAMPUS_PACK_CHECKED_ON = '10 November 2026';

const footer = (...sources: string[]) =>
  [
    '',
    ...sources.map((url) => `Source: ${url}`),
    `Checked: ${CAMPUS_PACK_CHECKED_ON}. From the Campus Recall campus pack, a student project, not an official IITGN service. Open the source page if something may have changed.`,
  ].join('\n');

export const CAMPUS_PACK_NOTES: readonly CampusPackNote[] = [
  {
    key: 'exams',
    title: 'IITGN: which hall is my exam in?',
    text: [
      'Exam hall, room and seating plan for my exam.',
      '',
      'The public IITGN pages checked do not publish exam seating plans or exam hall allotments, so this pack cannot tell you your hall. When you get your seating notice (an email, a PDF or a photo of the notice board), save it in Campus Recall the day you get it. On exam morning, search "which hall is my exam in" or the course code and open the notice.',
      '',
      'On Android, select the email text or open the attached PDF, tap Share and choose Campus Recall. On iPhone or a laptop, copy the text into a note or save the PDF from Add.',
      '',
      'Room addresses on official pages are written like AB 3/102 or AB 4/335. See the note "IITGN: buildings and rooms".',
      '',
      'Exam windows in 2026-27 (the calendar calls them Examination I and Examination II):',
      'Semester I: Examination I 18 to 23 September 2026; Examination II 20 to 28 November 2026.',
      'Semester II: Examination I 19 to 24 February 2027; Examination II 23 to 30 April 2027.',
      footer('https://iitgn.ac.in/academics/calendar/acadcal-2026-27'),
    ].join('\n'),
  },
  {
    key: 'calendar',
    title: 'IITGN: academic calendar 2026-27',
    text: [
      'Semester dates, exam weeks and registration for 2026-27.',
      '',
      'Semester I (2026): registration 3 August (new PG students 17 July, new UG students 20 July). Classes start 4 August (new UG students 17 August). Examination I: 18 to 23 September. Examination II: 20 to 28 November.',
      '',
      'Semester II (2027): registration 2 January (new PG students 17 December 2026). Classes start 4 January. Examination I: 19 to 24 February. Examination II: 23 to 30 April.',
      '',
      'Holiday list for 2026: https://iitgn.ac.in/holiday/2026',
      footer(
        'https://iitgn.ac.in/academics/calendar/acadcal-2026-27',
        'https://iitgn.ac.in/holiday/2026',
      ),
    ].join('\n'),
  },
  {
    key: 'timetable',
    title: 'IITGN: course timetable and registration',
    text: [
      'Class timetable, course list and course registration.',
      '',
      'Course registration and your academic records are on the student portal (IMS): https://ims.iitgn.ac.in/student/',
      'Courses offered: https://iitgn.ac.in/academics/courses',
      '',
      'The public IITGN pages checked have no timetable page. The academic officials page lists a faculty in-charge for the time table. When your timetable is shared (a PDF, a spreadsheet screenshot or an email), save it in Campus Recall so you can search "where is my Tuesday class".',
      '',
      'Academic office: academics@iitgn.ac.in, 079-2395-2052 to 2055.',
      footer(
        'https://iitgn.ac.in/academics',
        'https://iitgn.ac.in/about/academic-officials',
        'https://iitgn.ac.in/contact',
      ),
    ].join('\n'),
  },
  {
    key: 'buildings',
    title: 'IITGN: buildings and rooms',
    text: [
      'How to read a room address and find a building on the Palaj campus.',
      '',
      'Official pages write room addresses as AB, then the block number, then the room: for example the Student Affairs office is AB 3/102, and faculty offices include AB 4/335, AB 11/311 B and AB 13/405-C.',
      '',
      'Places named on official pages:',
      'Central Library: Block 3 in the Academic Area. A mini-library is in the hostel area.',
      'Jasubhai 600 Auditorium: Academic Block 2, ground floor.',
      'Academic Block 7 and the Srujan Area are also used as venues.',
      'Medical Centre: Central Arcade, first floor.',
      'Hostel office: Beauki 121.',
      footer(
        'http://students.iitgn.ac.in/student_affairs/',
        'https://iitgn.ac.in/students/student-wellbeing',
        'https://sites.google.com/iitgn.ac.in/t4econference/conference-venues',
        'https://iitgn.ac.in/research/library',
        'https://iitgn.ac.in/medicalcenter',
      ),
    ].join('\n'),
  },
  {
    key: 'health',
    title: 'IITGN: medical emergency and well-being contacts',
    text: [
      'Doctor, medical emergency, health centre and mental health help on campus.',
      '',
      'Medical Centre, Central Arcade first floor.',
      'Medical emergency: +91 70 69 79 5000',
      'Medical Centre landline: 079-2395-1116',
      'Email: medical@iitgn.ac.in',
      'Doctor hours are listed on the Medical Centre page.',
      '',
      'Student well-being: wellbeing.students@iitgn.ac.in',
      'Tele-MANAS tele-mental health helpline, 24x7 and toll-free: 14416 or 1800-891-4416',
      '',
      'The official pages checked say an ambulance is available on campus at all times but give no ambulance or campus security number. Add those to this note when you have them.',
      footer('https://iitgn.ac.in/medicalcenter', 'https://iitgn.ac.in/students/student-wellbeing'),
    ].join('\n'),
  },
  {
    key: 'contacts',
    title: 'IITGN: office phone numbers and emails',
    text: [
      'Who to call or email on campus.',
      '',
      'Academics: academics@iitgn.ac.in, 079-2395-2052, 2053, 2054, 2055',
      'Student Affairs (AB 3/102): student.affairs@iitgn.ac.in, 079-2395-2075, 2076, 2078, 2079',
      'Student hostels: 079-2395-1140, 079-2395-1260',
      'IT services (ISTF): 079-2395-2520, 079-2395-2083',
      'Library: libraryservices@iitgn.ac.in, 079-2395-1127, 1128, 1129',
      'Medical Centre: medical@iitgn.ac.in, 079-2395-1116',
      'Reception: 079-2395-2800 to 2809',
      footer('https://iitgn.ac.in/contact', 'http://students.iitgn.ac.in/student_affairs/'),
    ].join('\n'),
  },
  {
    key: 'hostels',
    title: 'IITGN: hostels, hostel office and rules',
    text: [
      'Hostel names, the hostel office, hostel rules and maintenance requests.',
      '',
      'The twelve hostels, A to L: Aibaan, Beauki, Chimair, Duven, Emiet, Firpeal, Griwiksh, Hiqom, Ijokha, Jurqia, Kyzeel and Lekhaag. They house more than 2600 students.',
      '',
      'Hostel office: Beauki 121, phone 079-2395-1140.',
      'Hostel norms (rules): https://iitgn.ac.in/assets/pdfs/IITGN_Hostel_Norms.pdf',
      'Hostel maintenance requests: https://maintenance.iitgn.ac.in/hostel.php',
      'The hostel page also links the Honour Code.',
      footer('https://students.iitgn.ac.in/student_affairs/hostel.php'),
    ].join('\n'),
  },
  {
    key: 'mess',
    title: 'IITGN: mess and food',
    text: [
      'Mess menu, dining and where to eat.',
      '',
      'IITGN has two student-run messes, near the Griwiksh and Aibaan hostels. A student mess council plans the menu every month, and Jain food is available. The campus has the FSSAI Eat Right Campus five-star rating.',
      '',
      'The public IITGN pages checked do not publish the mess menu or meal times. When this month\'s menu is shared, save the photo or PDF in Campus Recall and search "what is for dinner today".',
      footer('https://students.iitgn.ac.in/student_affairs/hostel.php'),
    ].join('\n'),
  },
  {
    key: 'links',
    title: 'IITGN: useful links',
    text: [
      'Websites and portals students use.',
      '',
      'IITGN website: https://iitgn.ac.in',
      'Student portal (IMS, part of IPAS): https://ims.iitgn.ac.in/student/',
      'Academic calendar 2026-27: https://iitgn.ac.in/academics/calendar/acadcal-2026-27',
      'Courses: https://iitgn.ac.in/academics/courses',
      'Holidays 2026: https://iitgn.ac.in/holiday/2026',
      'Internal Website (IWS): https://sites.google.com/iitgn.ac.in/iws/',
      'Library: https://iitgn.ac.in/research/library',
      'Hostel maintenance: https://maintenance.iitgn.ac.in/hostel.php',
      'Medical Centre: https://iitgn.ac.in/medicalcenter',
      'IITGN email (webmail) is on Google: https://mail.google.com/a/iitgn.ac.in',
      footer('https://iitgn.ac.in', 'https://iitgn.ac.in/academics'),
    ].join('\n'),
  },
  {
    key: 'library',
    title: 'IITGN: library hours and contact',
    text: [
      'Library location, opening hours, book issue and return.',
      '',
      'Central Library: Block 3 in the Academic Area. A mini-library is in the hostel area.',
      'Open about 9:00 am to 9:00 pm; book issue and return 9:00 am to 8:00 pm. The page lists hours in more than one place, so check it before a late visit.',
      'Phone: 079-2395-2431. Library services: libraryservices@iitgn.ac.in, 079-2395-1127 to 1129.',
      footer('https://iitgn.ac.in/research/library', 'https://iitgn.ac.in/contact'),
    ].join('\n'),
  },
];

type PackServices = Pick<CampusRecallServices, 'library' | 'preferences'>;

/** Keys of the pack notes this device has saved. Kept after a note is deleted, so it stays deleted. */
async function savedKeys({ preferences }: PackServices): Promise<string[]> {
  const value = await preferences.get<{ saved?: unknown }>(CAMPUS_PACK_PREFERENCE);
  return Array.isArray(value?.saved)
    ? value.saved.filter((key): key is string => typeof key === 'string')
    : [];
}

/** The pack notes not saved yet. A note saved once stays recorded, even after it is deleted. */
export async function missingCampusNotes(services: PackServices): Promise<CampusPackNote[]> {
  const saved = new Set(await savedKeys(services));
  return CAMPUS_PACK_NOTES.filter((note) => !saved.has(note.key));
}

/**
 * Saves the missing pack notes one by one, recording each after its save. A failure part way
 * keeps what was saved and returns it with the failure, so a retry saves only the rest.
 */
export async function addCampusPack(
  services: PackServices,
): Promise<{ items: LibraryItem[]; failure?: unknown }> {
  const items: LibraryItem[] = [];
  try {
    const saved = await savedKeys(services);
    for (const note of await missingCampusNotes(services)) {
      items.push(await services.library.save({ kind: 'note', title: note.title, text: note.text }));
      saved.push(note.key);
      await services.preferences.set(CAMPUS_PACK_PREFERENCE, { saved });
    }
  } catch (failure) {
    return { items, failure };
  }
  return { items };
}
