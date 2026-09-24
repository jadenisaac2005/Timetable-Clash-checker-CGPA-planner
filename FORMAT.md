# Data formats

## 1. The university's registration files — NOT YET DOCUMENTED

The brief asked for this section to describe the exact structure of the university's
course-list/timetable files in `data/`. **When this project was set up, `data/` did not exist
and the repository had no commits**, so no university file has been read and nothing below is
a description of it.

No Amity-specific parser has been written, on purpose: guessing column names, slot naming or
time notation is exactly the kind of error that makes a clash checker silently wrong.

To finish this part:

1. Commit one or more real files (xlsx/csv/pdf-export, exactly as downloaded) into `data/`.
2. Fill in this section with what they actually contain:
   - sheet(s) and header row(s), exact column names and order
   - how a section is identified (section code? faculty? batch?)
   - how slots are named, and whether times are given per row or only via a separate slot grid
   - how times are written (24h? `10:50-11:40`? `10.50 AM`? periods numbered 1..n?)
   - how theory, lab, TEL (theory + lab) and project/dissertation courses differ
   - merged cells, multi-line cells, footnotes, anything else irregular
3. Write an adapter `src/import/<name>.ts` that converts the file into the canonical rows
   below (`RawRow[]`). Everything downstream (clash detection, solver, UI) already works on
   the canonical model, so only the adapter is format-specific.

Until then, students can convert the university file to the canonical CSV by hand (or with a
spreadsheet formula) — see `examples/sample-timetable.csv`.

---

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
