---
'payload-live-preview': patch
---

The `image` renderer writes the picture the element shows. Any string became `src`, so alt text, a document id or a number bound to an `<img>` broke the image; a string that names no address (whitespace in it, or no `/`, `.` or `:`) is now left alone and counts as a value the renderer cannot write (`LP0411`), as a bare relation id already did. An `<img>` whose `data-payload-alt` names its own field gets the value as its `alt` and keeps its `src`. The rebuilt `srcset` mixed every size, crops of other shapes, other formats and two candidates of one width included, and `src` became the original. Now `src` stays the size the template chose (and the same size of the next image the editor picks), and the `srcset` holds only the sizes of that picture's shape and format, one per width. Applies to `upload` on an `<img>` as well.
