import {loadEnv} from '../src/config.mjs';
import {threadInstallableConfig,threadInviteUrl} from '../src/thread-config.mjs';
loadEnv();loadEnv('.env.threads');
const cfg=threadInstallableConfig();
if(!cfg.applicationId)throw new Error('Set THREAD_DISCORD_APPLICATION_ID in .env.threads');
console.log(threadInviteUrl(cfg.applicationId));
