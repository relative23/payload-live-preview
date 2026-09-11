---
'payload-live-preview': minor
---

`autoBind: 'unique'` lets the runtime find bindings by value on the
connection's first message, for a page that carries no `data-payload-field` at
all. A scalar field whose value is the whole content of exactly one element in
the body — its only text node, an attribute the writer may set, an `<img src>`
for an upload — is bound to that element as if the attribute had been written
there. Found nowhere, more than once, partially or split across nodes: nothing
is bound, and the field stays as unbound as it was.

Every guess is stamped onto its element as the attributes a template would have
carried plus `data-payload-guessed` with the value it matched, is listed in
`inspect().bindings.guessed`, and appears under its own heading in the
unbound-fields overlay with the attribute to paste. A declared
`data-payload-field` always wins; `data-payload-no-bind` keeps a subtree out.
The option is off by default and is accepted by the client, the inline script
and every adapter (ADR 0014).

A route refresh keeps the guesses. The refresh morphs the page toward the
server's markup, which carries no stamp, so the runtime looks for the guesses
it already made on the fresh markup — by the value each was found by and by the
field's current value — and for nothing else; a field the first message did not
bind is not bound by a refresh either.
