# The scope module

It is `templates/data-app/scope.js`, copied with the frame (`reference/app-frame.md`); adapt the parts marked ADAPT to
the model's real names. It builds every query
the app runs and the app's address, and holds no DOM code, so you can test it with `node` before any page exists.
Adapted from the avalanche explorer in this repository, `packages/avalanche`.

`known` holds what distinct-value queries returned when the app loaded: for a `pick` key, the list of its values;
for `from` and `to`, the `[min, max]` the data spans; for the entity, the list of its ids. Nothing from the address
or a click reaches a query unless it is in `known`. Values of `pick` keys and entity ids are strings, because that
is what an address holds: make codes such as ZIP codes string dimensions in the model.

The address is the route and then the scope: `#/explore?borough=BROOKLYN&from=2023`,
`#/zip/10035?from=2023`, `#/compare?ids=10035,10452`. Every view of the app, with every filter, can be shared.

A scope key on the entity's own field, such as a `state` pick when the entity is a state, is listed in
`ENTITY_KEYS`. The entity's page and Compare choose the entity themselves, so they leave it out: `entityQuery`,
`compareQuery` and the scope bar do so already, and any `viewQuery` or `tileQuery` those pages run, such as the
entity's numbers against the whole, takes `S.skipFor(route.view)` as its `ignore` or `skip`. Explore and Records keep
the key. A key counts only when its `field` is the entity's `field`, the same name and unqualified, so give
such a pick exactly the entity's field.


Check it before the app uses it: import it in a small `node` script with a sample `known`, parse a few
hand-written addresses (one with a quote in a value, one with an unknown id), and run two or three of the strings
it builds through the `malloy` MCP server and look at the rows.
