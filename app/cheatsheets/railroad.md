# Railroad / syntax diagram (beta)

```mermaid
railroad-ebnf-beta
word = letter , { letter } ;
letter = "a" | "b" | "c" ;
```

Variants: `railroad-ebnf-beta` (EBNF), `railroad-abnf-beta` (ABNF), `railroad-peg-beta` (PEG)
and `railroad-beta`.

EBNF: `,` sequence, `|` choice, `[ x ]` optional, `{ x }` repeat, `"text"` terminal, rules end with `;`.
