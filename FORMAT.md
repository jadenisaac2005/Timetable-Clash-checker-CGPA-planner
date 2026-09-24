# Data formats

## 1. The university's registration files (Fall 2026-27)

Two files, both in `data/`:

| file | what it holds |
|---|---|
| `Course_Registration_File_for_the_academic_year_2026_-Fall_Semester_-Student_Copy.xlsx` | every offering: course code, title, hours, credits and **slot names** only |
| `Slot_Timetable_for_Fall_2026-27_Semester.docx` | the **slot grid**: which day and time each slot name means |

Neither file has times and slot names together. Every class time comes from looking a slot name up in the grid.

> **The committed copies are redacted.** Faculty names (xlsx cells I170–I184 and I186–I189), room numbers (H213–H214) and the author/last-modified-by fields of both files have been blanked. Nothing else is changed. The importer ignores these cells anyway: it never stores, shows or quotes faculty, room or other free text from the slot columns.

"Row N" below is the 1-based spreadsheet row number, as Excel shows it. The importer uses the same numbers in its messages. "Sl. No." is the file's own serial number, which is **not** unique: it restarts in every table and has gaps.

### 1.1 Registration workbook (.xlsx)

One sheet, `Student Data`. Its used range is `A1:R214`, but columns J–R are empty in every row. The only merged cell is `A125:C125`. The sheet is **five tables stacked vertically**, each starting with its own header row. The header wording differs between tables:

| header row | columns A–I as printed | data rows |
|---|---|---|
| 1 | `Sl.NO` · `Course Category` · `Course Code` · `Course Name` · `L` · `P` · `C` · `Theory slot` · `Lab slot` | 2–146 |
| 149 | `Sl. No.` · `Program` · `Course Code` · `Course Title` · `T` · `P` · `C` · `Theory Venue` · `Lab Slot` | 150–168 |
| 169 | same labels as row 149 | 170–184 |
| 185 | `Sl. No.` · `Program` · `Course Code` · `Course Title` · `T` · `P` · `C` · `Lab Slot` · `Faculty_Lab` | 186–211 |
| 212 | same labels as row 185 | 213–214 |

- **Hours and credits.** The lecture-hours column is headed `L` in the first table and `T` in the others. `P` is weekly practical hours and `C` is credits. All are plain integers.
- **The labels after `C` can't be trusted.**
  - In the table at row 149, the column headed `Theory Venue` holds **theory slots**, e.g. row 150 `D1+TA1`.
  - In the table at row 169, the same `Theory Venue` column holds **lab slots** (row 170 `L11+L12`), and the column headed `Lab Slot` holds **faculty names** (removed from the committed copy).
  - The importer therefore decides what each cell after `C` is by its **content**: a theory-slot expression, a lab-slot expression, the project marker, or other text. Other text (faculty, venue, notes) is ignored. It reports every table whose header disagrees.
- **Sub-headings.** Three rows have text but no course code, and mark who the following rows are for:
  - row 125: `5th Sem 3rd year ECE/ECE(EVT)/ES&VLSI one batch (lab)` (merged `A125:C125`)
  - row 133: `3rd Sem 2nd year ECE/ECE(EVT)/ES&VLSI` (in column B; E–G hold non-breaking spaces)
  - row 141: `M.Tech 2nd year`
- **Blank rows:** 134, 147, 148.
- **Stray whitespace.** Cells carry trailing spaces (`'CSE1017 '` in rows 2–13, `'Cloud Computing '` in rows 117–123), a leading tab (row 167 `'\tChemistry for Engineering Applications'`) and non-breaking spaces. The importer trims all of these.
- **Course category** (column B of the first table) is free text: `SC`, `PC`, `CE`, `SE`, `PC-CE`, `CE/PC`, `IOT basket`, `Robotics Basket`, `Prigram core` (sic, row 140) and so on. In the other tables, column B is `Program` (`B.Tech`, `All UG`) or blank. It is shown for information only.

#### Sections

There is **no section or batch identifier column**. Each data row is one offering. Several rows can be identical apart from Sl. No. — for example, rows 26 and 34 are both CSE2001 `A2` + `L3+L4`. Rows 170 and 174 are both SSK2002 `L11+L12`.

A student can only tell offerings apart by their slots, so the importer makes **one section per distinct slot combination**. It names the section by its slots (e.g. `A2 · L3+L4`) and lists the source rows.

#### Slot names

- **Theory slots**, from the grid: `A1`–`G2` (`A1, A2, B1, B2, …, G1, G2`) and `TA1, TA2, TB1, TB2, TC1, TC2`. A cell can combine several with `+`: `D1+TA1` (row 150), `E1+TC1` (rows 154, 159, 162).
- **Lab slots** `L1`–`L40` always appear as pairs `L<odd>+L<odd+1>`, one 100-minute block. A cell can hold several blocks separated by `,` (row 2: `L25+L26,L39+L40`), `" , "` (row 116) or `&` (row 164: `L9+L10 &L1+L2`).
- **Irregular spellings.** Each has exactly one reading. The importer accepts it, corrects it and **lists it in the import report**:

  | row | cell | read as | why |
  |---|---|---|---|
  | 9 (CSE1017) | `31+32` | L31+L32 | no `L` — but it's in the Lab slot column, and no theory slot is named 31 |
  | 19 (CSE2046) | `L15+16` | L15+L16 | second `L` missing |
  | 171, 172, 173 (SSK2002) | `L35 +36`, `L23 +24`, `L19+ 20` | L35+L36, L23+L24, L19+L20 | second `L` missing, stray spaces |
  | 186–189 (KAN1005) | `L21-L22`, `L11-L12`, `L33-L34`, `L39-L40` | L21+L22, … | hyphen instead of `+` |

  Any other lab-slot shape is rejected, e.g. a non-consecutive pair or a number outside 1–40.

#### TEL (theory + lab) courses: chosen together, on one row

A TEL course's theory slot and lab slot(s) are on the **same row**, and each row pairs a different theory slot with a different lab block. For example, rows 2–13 give CSE1017 twelve different theory+lab combinations: row 2 `F1` + `L25+L26,L39+L40`, row 3 `D2` + `L15+L16,L5+L6`, and so on. No TEL course has a separate lab-only row.

So theory and lab are **chosen together**: a section is the whole row. The importer uses a single component, and the solver never pairs a theory slot with a lab block from a different row.

Courses with `P = 4` (e.g. CSE1017, ECE1010) have two lab blocks per row. Lab-only courses have `L/T = 0` and only a lab slot:
- CSE3050 (row 142)
- SSK2002/SSK3001 (rows 170–184)
- KAN1005 (rows 186–189)

#### Project courses and rows without a slot

- **Only one row is marked as a project:** row 82, ECE3026 *Building Robots*, `L 0 · P 0 · C 3`. Its theory slot is blank and its lab-slot cell reads `(PROJECT BASED COURSE-  NO SLOTS ARE REQUIRED)`. The importer recognises that marker and imports the course with no meetings, so it never clashes.
- **Rows with no slot at all, and not marked as a project**, are **skipped and listed**. The importer doesn't guess their times:
  - KAN1004 (rows 190–195)
  - FRE1002 (rows 196, 198, 204, 206, 207, 209, 211)
  - `FRE1002/SPA1001` (rows 197, 199–203, 205, 208, 210). This code also names two courses in one cell.
  - POS1045/POS1044 (rows 213–214). Their `Lab Slot` column holds a room number, not a slot (blanked in the committed copy), and `Faculty_Lab` holds `Open Elective`.
- **Theory slot blank but `L > 0`**, so the class times are unknown: row 38 (CSE2007, Sl. No. 37) and row 52 (CSE1035, Sl. No. 53). Both have a lab slot. These rows are skipped and listed.

#### Other things the file does that the importer reports as warnings

- **Same code, two courses.** ECE3036 is *Robotic System Mechanics* in row 81 (Robotics Basket) and *System and Network on Chip* in row 132 (VLSI basket/CE). They are kept as two courses, shown as `ECE3036 [title]`.
- **Hours that don't match the slots:**
  - row 116 ECE1010, row 135 ECE2034, row 138 ECE1006: two lab blocks, but `P = 2`
  - row 137 ECE2032: `L = 3` but `F1` meets twice a week; also a lab slot with `P = 0`
  - row 140 ECE2043: lab slot `L23+L24` with `P = 0`
  - row 164 PHY1001: `T = 3` but `G1` meets twice a week; also two lab blocks with `P = 0`
- **Sl. No. gaps** in the first table (47, 48, 54–56, 65 are missing). These are informational only.

### 1.2 Slot timetable (.docx)

The document has one paragraph (`Program: xxxxx`, a template placeholder) and three tables:

1. **The slot grid**: 12 rows × 11 grid columns. This is the only table the importer uses.
2. A one-row legend: `A1, B1, C1, D1+TA1, … are 3 credit theory slots`, `L1 to L40 are laboratory slots, each of 100 minutes (e.g.: L1+L2) starts with an odd number (20 Nos.)`.
3. An empty course-list template (`Sl. No. | Course Code | Course Title | T-P-C | Course type (T/P/TEL/PJ/NC) | Slot | Venue | Faculty`, 8 blank rows). It is ignored.

In the grid, grid-column indices below count from 1:

- **Row 1**, `Theory Hours` (spans columns 1–2), then nine time ranges: `9:00 - 9.50`, `9.55 - 10.45`, `10.50- 11.40`, `11.45 - 12.35`, `12.35 - 1.15` (lunch, merged vertically through all day rows), `1.15 – 2.05`, `2.10 - 3.00`, `3.05 – 3.55`, `4.00 – 4.50`.
- **Row 2**, `Lab Hours`. Each lab range spans two grid columns: `9.00 AM – 10:40 AM`, `10.50 AM – 12.30 PM`, lunch, `1.15 PM – 2.55 PM`, `3.05 PM – 4.45 PM`.
- **Rows 3–12**, one `Theory` row and one `Lab` row per day, `MON`–`FRI`. The day cell is merged vertically across both rows.
  - Each cell names the slot held in that column's period.
  - A theory slot repeats across the week: `A1` is Mon period 1, Wed period 2 and Fri period 3.
  - A lab slot's two halves sit under one lab range: `L1` and `L2` both fall under Mon 9:00–10:40.

**Times: 12-hour, without AM/PM, in the theory row.** Row 1 writes `1.15 – 2.05` … `4.00 – 4.50` with no AM/PM, uses `:` and `.` interchangeably, and mixes `-` with `–`. Row 2 does write AM/PM (`1.15 PM – 2.55 PM`).

The importer reads each row left to right. A time that would fall *before* the previous one is read as PM; anything still out of order is an error. This gives theory periods:

| period | 1 | 2 | 3 | 4 | lunch | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| time | 09:00–09:50 | 09:55–10:45 | 10:50–11:40 | 11:45–12:35 | 12:35–13:15 | 13:15–14:05 | 14:10–15:00 | 15:05–15:55 | 16:00–16:50 |

Lab blocks come out as 09:00–10:40, 10:50–12:30, 13:15–14:55 and 15:05–16:45. The explicit `1.15 PM` in row 2 confirms the afternoon reading. Note that lab blocks don't line up with theory periods: a lab block starting at 10:50 overlaps **both** period 3 (10:50–11:40) and period 4 (11:45–12:35).

The Fall 2026-27 grid is built into the app (`src/import/university/fall2026Grid.ts`), and a test checks it equals what the .docx parser reads. A student can upload a newer slot-timetable .docx to replace it.

### 1.3 Parse result for the Fall 2026-27 file

- **Rows:** 214 read: 5 table headers, 3 sub-headings, 3 blank and 203 course rows.
- **Imported: 177 course rows**, giving 58 courses and 162 sections. 9 slot spellings were corrected (table above).
- **Skipped: 26 course rows**, all listed above: 6 KAN1004, 16 FRE1002 or FRE1002/SPA1001, 2 POS, and 2 with a blank theory slot.
- **The regression test** checks these numbers, a hand-counted section count for several courses, and real clashes from the file: see `tests/university.test.ts`.

## 2. Canonical timetable CSV (this tool's own format)

One row **per meeting** (a class occurrence on one day). A section that meets three times a
week has three rows. Header row required; column order does not matter; header names are
case-insensitive.

| column         | required | meaning |
|----------------|----------|---------|
| `course_code`  | yes      | e.g. `CSE301`. Courses are what the student picks. |
| `course_title` | no       | free text |
| `credits`      | yes*     | number; *must appear on at least one row of the course |
| `course_type`  | no       | `theory` · `lab` · `tel` · `project` (default `theory`) — informational |
| `component`    | no       | a part of the course that needs its **own** section choice, e.g. `theory`/`lab` for a TEL course where the theory section and lab batch are picked separately. Default `main`. |
| `section`      | yes      | section/batch identifier within the component, e.g. `A`, `L3` |
| `slot`         | no       | slot name as printed by the university, e.g. `A1`, `L21`. Informational unless times are blank (see slot map). |
| `day`          | cond.    | `Mon` … `Sun` (also `Monday`, `MON`, `M`, `Tu`, `Th`…) |
| `start`        | cond.    | `HH:MM` 24-hour, or with `AM`/`PM` (`10:50`, `1:30 PM`, `13:30`, `1050`, `10.50`) |
| `end`          | cond.    | same as `start`; must be after `start` |
| `faculty`      | no       | free text |
| `room`         | no       | free text |

`day`/`start`/`end` are either all present or all blank. If blank:

- if `slot` is set and a **slot map** is loaded, the slot's meetings are used;
- otherwise the row contributes **no meeting** — this is how project/dissertation/internship
  courses are expressed. A section with no meetings never clashes with anything.

A slot map entry can have several rows (multi-day slots). A row's `slot` may list several
slots separated by `+`, e.g. `L1+L2` (a two-period lab).

**Clash rule:** two meetings clash iff they are on the same day and their half-open intervals
`[start, end)` overlap. 10:00–10:50 and 10:50–11:40 touch but do **not** clash. Slot names are
never compared.

**TEL courses** can be written two ways:

- one `component` (`main`) where each section has both theory and lab rows — the student gets
  theory and lab together;
- two components (`theory`, `lab`) — the solver picks one theory section **and** one lab
  section independently.

Rows with the same `course_code` + `component` + `section` are merged into one section.

## 3. Slot map CSV (optional)

```
slot,day,start,end
A1,Mon,08:00,08:50
A1,Wed,09:00,09:50
L1,Tue,10:50,11:40
```

## 4. Curriculum config JSON

See `README.md` → *Curriculum config* and `examples/curriculum.example.json`.
