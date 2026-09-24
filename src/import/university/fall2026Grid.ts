/**
 * Slot grid for the Fall 2026-27 semester, copied cell-for-cell from the first table of
 * data/Slot_Timetable_for_Fall_2026-27_Semester.docx (merged cells expanded). Used when the
 * student has not uploaded a slot-timetable document of their own. tests/university.test.ts
 * checks that parsing the .docx gives exactly this table.
 */
export const FALL_2026_27_SLOT_TABLE: string[][] = [
  ["Theory Hours","Theory Hours","9:00 - 9.50","9.55 - 10.45","10.50- 11.40","11.45 - 12.35","12.35 - 1.15","1.15 – 2.05","2.10 - 3.00","3.05 – 3.55","4.00 – 4.50"],
  ["Lab Hours","Lab Hours","9.00 AM – 10:40 AM","9.00 AM – 10:40 AM","10.50 AM – 12.30 PM","10.50 AM – 12.30 PM","12.35 - 1.15","1.15 PM – 2.55 PM","1.15 PM – 2.55 PM","3.05 PM – 4.45 PM","3.05 PM – 4.45 PM"],
  ["MON","Theory","A1","F1","D1","TC1","LUNCH","A2","F2","D2","TC2"],
  ["MON","Lab","L1","L2","L3","L4","LUNCH","L21","L22","L23","L24"],
  ["TUE","Theory","B1","G1","E1","TA1","LUNCH","B2","G2","E2","TA2"],
  ["TUE","Lab","L5","L6","L7","L8","LUNCH","L25","L26","L27","L28"],
  ["WED","Theory","C1","A1","F1","B1","LUNCH","C2","A2","F2","B2"],
  ["WED","Lab","L9","L10","L11","L12","LUNCH","L29","L30","L31","L32"],
  ["THU","Theory","D1","B1","G1","C1","LUNCH","D2","B2","G2","C2"],
  ["THU","Lab","L13","L14","L15","L16","LUNCH","L33","L34","L35","L36"],
  ["FRI","Theory","E1","C1","A1","TB1","LUNCH","E2","C2","A2","TB2"],
  ["FRI","Lab","L17","L18","L19","L20","LUNCH","L37","L38","L39","L40"],
];
