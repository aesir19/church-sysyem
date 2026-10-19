# D-Group leader view

Owner-approved functional scope, 16 October 2026. Implementation base: staging
`45e70e8`; branch: `refactor/d-group-leader-view`. Mockups: file 13 (13a–13i) in
`UI mockups for form/design_handoff_church_dashboard/`. Delivered in two phases, each
its own pull request and review.

## Purpose

A D-Group leader signs in to a dashboard about their D-Group and its members, not the
church at large. It reuses existing Overview patterns, tokens and components, including
dark mode and the phone layout. Sidebar and tab bar are unchanged by this work.

D-Group Leader is derived from leading a group, not a role (`docs/decisions/0014`).

## Who sees it

| Person | Overview shows |
| --- | --- |
| Leads a D-Group, no other elevated role | The D-Group view, no switch (13a, 13b) |
| Leads a D-Group and holds an elevated role (Pastor, Church Leader, Welcome, etc.) | A **Church \| My D-Group** switch; opens on Church; the device remembers the last choice (13c, 13d) |
| Does not lead a D-Group | The normal Overview, unchanged |

Leading two or more groups: members combined by default, with a group filter that only
appears with 2+ groups. Every member row and list item names its group (13e).

## What a leader may see about members

Unchanged from today: names, birthday as day and month only, Sunday service attendance,
serving, and journey progress. No address, contact details, or member record. Tapping a
member opens the group page. No ranking, no call or message buttons, no meetings figure.

## Phase 1 — the dashboard (reads only)

Order, top to bottom on phone; on desktop items 1–6 in the main column, 7 on the rail.

1. **Group header** — group name(s), member count, the group filter when 2+ groups.
2. **Sunday attendance** — "6 of 9 at last Sunday's service", with who was not there.
   Sunday services only, never called "meetings".
3. **Check on** — members who missed 2 or more of the last 4 Sunday services held
   after they joined the group, newest absence first. Worded "missed Sunday service".
4. **This week** — one list: members' birthdays this week, upcoming serving this week
   (e.g. "Felix · Ushering · Sun"), and members who joined in the last 30 days. The
   heading's date range must not suggest the joins happened this week.
5. **Discipleship progress** — Baptized, One-to-one started, Turning point as "X of Y".
   Read-only; recording stays on the group page.
6. **My members** — one row per member: last 4 Sunday services as dots (present /
   missed / not yet in group), "Served N times in the last 3 months", journey badges.
7. **Church · next 7 days** — church-wide services and events only, compact, link to
   Calendar. No church totals.

Serving counts confirmed event assignments only; open assignments do not count.

Empty states: a group with no members (13f1) and a new group with no Sunday service yet
(13f2), where Check on explains why it is empty.

### Data

- Group membership gains a **joined date** and groups gain a **start date**, both
  filled automatically from now on. Existing rows have no date and are treated as
  members since before the 4-week window (never shown as "not yet in group").
- One database function returns the dashboard figures for **only the groups the
  signed-in person leads**, and nothing for anyone who leads none. Today the database
  grants leaders attendance church-wide and the screen narrows it; this view must not
  depend on that.
- Birthdays come without a year, as the Calendar's birthday read already does.

## Phase 2 — leaders' Group meetings

Separate pull request and security review.

- Events gain an optional link to a D-Group. It is **required** for new Group
  meetings. Older Group meetings without a group stay as they are and appear in no
  group's view.
- **+ Group meeting** on the D-Group view opens a short form (13h): title, date, start
  and end time, location, notes, group (only groups the person leads), repeat (doesn't
  repeat / weekly / every 2 weeks / monthly). Leaders never see the full composer or
  the Events page. No budget, rooms, serving roles, programme or closeout.
- Repeating meetings use the existing series tools (move, change from here on, split,
  delete this / this and following / whole series), widened to "leader of this group,
  Group meetings only" (13i).
- Meetings go live immediately; no approval.
- A Group meetings section is added to the D-Group view's rail (13g).
- The Phase 1 "Church · next 7 days" section must leave Group meetings out. Today it
  shows every published event, which is right only while every event is church-wide.

### Permissions

| Actor | Create | Edit / move / cancel | Delete |
| --- | --- | --- | --- |
| Leader of that group | Yes | Yes | Before the meeting date only |
| Events Team | No | Yes, any group | Before the meeting date only |
| SuperAdmin | No | Yes, any group | Before the meeting date only |
| Anyone else | No | No | No |

After the meeting date a meeting can be cancelled, not deleted. "Group meeting" is no
longer offered in the Events team's composer.

### Visibility

Meetings are often held in a member's home. A Group meeting — on the Calendar and
everywhere else — is visible only to that group's members and leaders, the Events Team
and SuperAdmin. The form says "Only this group sees it on the Calendar" (replaces the
mockup's "Not shown on the church Calendar"). Enforce in the database, including direct
API calls.

### Decided while building (owner, 16 October 2026)

- **Repeat** (D1–D4): weekly and every 2 weeks count from the first date; monthly is the
  same weekday each month (the 1st Thursday), and a fifth weekday becomes "the last".
  A repeat ends after N meetings (the form defaults to 8) or never.
- **The Group meetings card** shows each repeating meeting once, at its next date, then
  upcoming one-offs, then meetings from the last 14 days. A later date of a repeating
  meeting is changed from the Calendar.
- **The form** (S1, S2): an "Ends: after [N] meetings / never" control under Repeat.
  "Edit…" changes this meeting only; "Change from here on…" changes this date and every
  one after it (the split), restarting the count from that date.
- **Cancel** (S3) asks for confirmation and takes an optional reason, which group members
  see beside the cancelled meeting on the Calendar.
- **"Delete → This meeting"** on a repeating meeting marks that date cancelled (the repeat
  engine cannot leave a date out without a saved row); "This and following" ends the
  series the day before; "The whole series" deletes it, keeping its past.
- **On a phone** (S4) the Group meetings card sits right after This week.
- **On the Calendar** a meeting's preview names its group and offers no "I can serve".
  A leader of that group gets the meeting's actions there; the Events Team and SuperAdmin
  keep "Go to event" instead (C1).
- **Deleting a D-Group deletes its meetings** — rather than leaving them without a group,
  which would make a member's home address visible to the whole church.
- **0057** fixes a bug found during the live check that also affected the Events team:
  saving one date of any repeating event ("Skip this date", "This date only") was refused
  by the database, because its uniqueness rule was a partial index the save could not use.

## Mockup corrections

- 13e: Check on rows read "· undefined"; show the group name.
- 13b: on phone, the serving line stacks under the member's name.
- 13h: Calendar wording as in Visibility above.

## Exclusions

D-Group meeting attendance, leader access to member contact details or records, leader
creation of events other than Group meetings, ranking, contact actions.

## Cost

$0. New columns, database functions and policies only; no new service or vendor.

## Confirmed test boundaries

The owner confirmed these on 16 October 2026:

1. Database: the dashboard function returns only the caller's groups and nothing for a
   non-leader; Phase 2 create/edit/delete/visibility per the tables above, including
   direct API calls and the series functions.
2. Frontend data module: success, empty, denied and failed reads/writes.
3. Browser flows: plain leader, leader with an elevated role (switch and memory),
   multi-group filter, both empty states, and Phase 2's form and meeting menu.

Use synthetic fixtures. Show the implemented UI to the owner before review or commit.
