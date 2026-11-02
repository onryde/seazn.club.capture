import { Directory, File, Paths } from 'expo-file-system';
import type { QueueFiles } from '@/services/tapQueueStore';

/** A name, never a path: no separator, no `..`, so nothing climbs out of the folder. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * The tap queue's folder, `documentDirectory/scoring` (design §6.3): the document directory is safe from the system
 * clearing it, unlike the cache. Over expo-file-system's `File` and `Directory`. `move` is the platform's own, with
 * `overwrite`: on Android a rename and, where that cannot, `Files.move` with `REPLACE_EXISTING`
 * (`CopyMoveStrategy.LocalFile.tryNativeMove`, expo-file-system 57.0.7); that it holds on a phone is a device claim.
 */
export function createExpoQueueFiles(): QueueFiles {
  const folder = new Directory(Paths.document, 'scoring');
  let ready = false;
  const open = (): Directory => {
    if (!ready) {
      folder.create({ intermediates: true, idempotent: true });
      ready = true;
    }
    return folder;
  };
  const file = (name: string): File => {
    if (!NAME.test(name)) throw new Error('a queue file is named, not pathed');
    return new File(open(), name);
  };
  return {
    names: async () =>
      open()
        .list()
        .filter((entry): entry is File => entry instanceof File)
        .map((entry) => entry.name),
    read: async (name) => {
      const found = file(name);
      return found.exists ? found.text() : null;
    },
    write: async (name, text) => {
      file(name).write(text);
    },
    move: async (from, to) => {
      await file(from).move(file(to), { overwrite: true });
    },
    remove: async (name) => {
      const found = file(name);
      if (found.exists) found.delete();
    },
  };
}
