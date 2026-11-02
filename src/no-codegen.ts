import { z } from "zod";

// Zod compiles validators into generated code by default; this server has no use for that. Zod
// reads this setting when a schema is created, and the SDK creates its schemas on import, so this
// module has to be imported before the SDK.
z.config({ jitless: true });
