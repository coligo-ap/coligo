// Enregistre le hook de résolution « @/ » (voir _alias-hooks.mjs).
import { register } from "node:module";

register("./_alias-hooks.mjs", import.meta.url);
