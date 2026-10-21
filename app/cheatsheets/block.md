# Block diagram

```mermaid
block
    columns 3
    a["A"] b["B"] c["C"]
    d["Wide block"]:3
    a --> d
```

`columns N` sets the grid width; `id:2` makes a block span 2 columns.
`space` leaves a gap. Nest with `block:group ... end`.
Shapes follow flowchart syntax, for example `db[("Database")]`.

Docs: <https://mermaid.js.org/syntax/block.html>
