# Requirement diagram

```mermaid
requirementDiagram
    requirement r1 {
        id: 1
        text: Must be fast
        risk: high
        verifymethod: test
    }
    element e1 {
        type: service
    }
    e1 - satisfies -> r1
```

Requirement types: `requirement`, `functionalRequirement`, `interfaceRequirement`,
`performanceRequirement`, `physicalRequirement`, `designConstraint`.

Risk: `low`, `medium`, `high`. Verify method: `analysis`, `inspection`, `test`, `demonstration`.

Relationships: `contains`, `copies`, `derives`, `satisfies`, `verifies`, `refines`, `traces`.

Docs: <https://mermaid.js.org/syntax/requirementDiagram.html>
