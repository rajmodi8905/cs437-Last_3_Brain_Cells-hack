import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
function imports(directory: string) {
  return readdirSync(directory, { recursive: true })
    .filter((name) => /\.tsx?$/.test(String(name)))
    .flatMap((name) => {
      const file = path.join(directory, String(name));
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const found: { file: string; dependency: string }[] = [];
      function visit(node: ts.Node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          found.push({ file, dependency: node.moduleSpecifier.text });
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        )
          found.push({ file, dependency: node.arguments[0].text });
        ts.forEachChild(node, visit);
      }
      visit(source);
      return found;
    });
}
it('keeps replaceable views independent of storage, extraction and inference implementations', () => {
  const forbidden = imports('src/ui').filter(({ dependency }) =>
    /(?:^|\/)(?:engine|storage)(?:\/|$)|^(?:dexie|@huggingface\/transformers|onnxruntime-web)$/.test(
      dependency,
    ),
  );
  expect(forbidden).toEqual([]);
});
it('keeps application services and retrieval independent of the current UI', () => {
  const forbidden = [
    ...imports('src/app'),
    ...imports('src/engine'),
    ...imports('src/storage'),
  ].filter(({ dependency }) => /(?:^|\/)ui(?:\/|$)|\.css$/.test(dependency));
  expect(forbidden).toEqual([]);
});
