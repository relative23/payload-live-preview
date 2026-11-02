---
'payload-live-preview': patch
---

An image binding takes a path with a space in it again. Since 2.3.0 `/media/my photo.png` was refused as if it were alt text and the old image stayed; 2.2 wrote it and the browser encoded the space. A string now names an address when it starts with `/`, `./` or `../`, ends in an image's file extension, or holds a `/`, `.` or `:` and no whitespace. A bare word such as `hero` stays text, as it could be a name or an id: write `./hero` for a relative path.
