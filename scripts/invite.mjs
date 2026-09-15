import {loadEnv} from '../src/config.mjs';
import {installableConfig,inviteUrl} from '../src/installable-config.mjs';
loadEnv();console.log(inviteUrl(installableConfig().applicationId));
