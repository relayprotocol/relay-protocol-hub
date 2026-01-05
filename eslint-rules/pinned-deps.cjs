"use strict";

/**
 * Enforce pinned deps in package.json:
 * - allow protocols (workspace:, file:, link:, etc.) for internal packages
 * - require exact x.y.z for everything else
 * - no autofix
 */

const DEFAULT_DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function isObjectExpression(node) {
  return node && (node.type === "ObjectExpression" || node.type === "JSONObjectExpression");
}

function getPropKeyString(prop) {
  const k = prop.key;
  if (!k) return null;
  // JS parser: Literal
  if (k.type === "Literal" && typeof k.value === "string") return k.value;
  // jsonc-eslint-parser: JSONLiteral
  if (k.type === "JSONLiteral" && typeof k.value === "string") return k.value;
  return null;
}

function getLiteralString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "JSONLiteral" && typeof node.value === "string") return node.value;
  return null;
}

function getObjectPropertyValue(objExpr, keyName) {
  if (!isObjectExpression(objExpr)) return null;
  for (const p of objExpr.properties || []) {
    if (!p || (p.type !== "Property" && p.type !== "JSONProperty")) continue;
    const k = getPropKeyString(p);
    if (k === keyName) return p.value;
  }
  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Require pinned dependency versions in package.json" },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          depFields: { type: "array", items: { type: "string" } },
          excludeList: { type: "array", items: { type: "string" } },
          internalScopes: { type: "array", items: { type: "string" } },
          allowProtocols: { type: "array", items: { type: "string" } },
          allowProtocolsOnlyForInternal: { type: "boolean" },
          allowExactPrerelease: { type: "boolean" },
        },
      },
    ],
  },

  create(context) {
    const opt = context.options[0] || {};
    const depFields = opt.depFields || DEFAULT_DEP_FIELDS;
    const excludeList = opt.excludeList || [];
    const internalScopes = opt.internalScopes || [];
    const allowProtocols = opt.allowProtocols || ["workspace:", "file:", "link:"];
    const allowProtocolsOnlyForInternal = opt.allowProtocolsOnlyForInternal !== false; // default true
    const allowExactPrerelease = !!opt.allowExactPrerelease;

    const exact = allowExactPrerelease
      ? /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/
      : /^[0-9]+\.[0-9]+\.[0-9]+$/;

    function shouldExclude(name) {
      return excludeList.some((p) => name.startsWith(p));
    }

    function isInternal(name) {
      return internalScopes.some((p) => name.startsWith(p));
    }

    function isAllowedProtocol(version) {
      return allowProtocols.some((p) => version.startsWith(p));
    }

    function report(node, depName, field, version) {
      context.report({
        node,
        message:
          `Dependency "${depName}" in "${field}" must be pinned to an exact version (x.y.z). ` +
          `Got "${version}".` +
          (internalScopes.length ? ` Internal scopes: ${internalScopes.join(", ")}.` : "") +
          (allowProtocols.length
            ? ` Allowed protocols: ${allowProtocols.join(", ")}.` +
              (allowProtocolsOnlyForInternal ? " (internal only)" : "")
            : ""),
      });
    }

    return {
      "Program:exit"(program) {
        const expr = program.body?.[0]?.expression;
        if (!isObjectExpression(expr)) return;

        for (const field of depFields) {
          const depObj = getObjectPropertyValue(expr, field);
          if (!isObjectExpression(depObj)) continue;

          for (const p of depObj.properties || []) {
            if (!p || (p.type !== "Property" && p.type !== "JSONProperty")) continue;

            const depName = getPropKeyString(p);
            const version = getLiteralString(p.value);
            if (!depName || version == null) continue;

            if (shouldExclude(depName)) {
              continue;
            }

            // allow protocols
            if (isAllowedProtocol(version)) {
              if (allowProtocolsOnlyForInternal && !isInternal(depName)) {
                report(p.value, depName, field, version);
              }
              continue;
            }

            // require exact semver
            if (!exact.test(version)) {
              report(p.value, depName, field, version);
            }
          }
        }
      },
    };
  },
};
