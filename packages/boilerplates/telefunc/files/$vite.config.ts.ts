import { addVitePlugin, loadAsMagicast, type MaybeContentGetter } from "@batijs/core";

export default async function getViteConfig(currentContent: MaybeContentGetter) {
  const mod = await loadAsMagicast(currentContent);

  addVitePlugin(mod, {
    from: "telefunc/vite",
    constructor: "telefunc",
    imported: "telefunc",
  });

  return mod.generate().code;
}