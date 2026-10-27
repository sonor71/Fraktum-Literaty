# Literature migration manifest

The canonical in-repository history currently starts at the additive v0.19 boundary. Earlier production migrations must be reconciled from the linked project's migration table before a baseline is added.

- 202610040001 identity/discovery
- 202610040002 evaluation/fragments
- 202610040003 annotations/feedback
- 202610040004 achievements
- 202610110001 taxonomy v2
- 202610110002 RPC security hardening
- 202610110003 taxonomy v2 production reconciliation (idempotent repair for projects where the v2 relations are absent)
- 202610260001 profile UPDATE grant, privileged-field guard, coherent media lifecycle policies and atomic profile save
- 202610260002 persisted-admin verification RPC gate and scoped definer EXECUTE/search-path reconciliation
- 20261027113527 conversation creator INSERT RETURNING / creator-or-member SELECT policies (production hotfix reconciliation)
