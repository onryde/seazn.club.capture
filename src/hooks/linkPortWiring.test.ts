import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createFakeLinkPort } from '../../test/fakeLinkPort';

/**
 * The inert seam (AGENTS §13, class 1): `createNativePorts` is not run by any test, so what it wires is read from its
 * source. The update banner's two buttons reach the phone only through `Ports.link`, and a fake in `test/fakePorts.ts`
 * would pass without it.
 */
function linkInitializer(source: string): string | null {
  const file = ts.createSourceFile('nativePorts.ts', source, ts.ScriptTarget.Latest, true);
  let found: string | null = null;
  let inside = false;
  const visit = (node: ts.Node): void => {
    const entering = ts.isFunctionDeclaration(node) && node.name?.text === 'createNativePorts';
    if (entering) inside = true;
    if (inside && ts.isPropertyAssignment(node) && node.name.getText(file) === 'link') {
      found = node.initializer.getText(file);
    }
    ts.forEachChild(node, visit);
    if (entering) inside = false;
  };
  visit(file);
  return found;
}

describe('which link port the composition root wires', () => {
  const source = readFileSync(join(__dirname, 'nativePorts.ts'), 'utf8');

  it('the phone’s own Linking, built once', () => {
    expect(linkInitializer(source)).toBe('createNativeLink()');
  });

  it('is read from the source of createNativePorts only: the reader finds nothing in a source that does not wire one', () => {
    expect(
      linkInitializer('export function createNativePorts() { return { photo: 1 }; }'),
    ).toBeNull();
    expect(linkInitializer('const ports = { link: createNativeLink() };')).toBeNull();
  });
});

describe('the fake link port', () => {
  it('lists each URL asked for, in order, and rejects once told to refuse', async () => {
    const link = createFakeLinkPort();
    await link.openUrl('https://one.test');
    link.refuse();
    await expect(link.openUrl('https://two.test')).rejects.toThrow('no app can open this link');
    link.refuse(false);
    await link.openUrl('https://three.test');
    expect(link.opened).toEqual(['https://one.test', 'https://two.test', 'https://three.test']);
  });
});
