import {loadEnv} from '../src/config.mjs';
import {installableConfig} from '../src/installable-config.mjs';
import {hubInviteUrl} from '../src/hub-invite.mjs';
loadEnv();loadEnv('.env.hub');console.log(hubInviteUrl(process.env.HUB_DISCORD_APPLICATION_ID||installableConfig().applicationId));
