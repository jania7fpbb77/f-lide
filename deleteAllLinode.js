const {
  setToken, getLinodes, deleteLinode,
} = require('@linode/api-v4');
const _ = require('lodash');
require('dotenv').config();

const deleteAllLinodes = async () => {
  let dataLinodes = (await getLinodes()).data;
  const promises = dataLinodes.map(async (linode) => {
    console.log(`Delete linode [${linode.id} - ${linode.label} - ${linode.region} - ${linode.ipv4[0]}]`);
    return await deleteLinode(linode.id);
  });

  const chunks = _.chunk(5, promises);

  for (let chunk of chunks) {
    await Promise.all(chunk);
  }
};

(async () => {
  setToken(process.env.LINODE_TOKEN);
  await deleteAllLinodes();
})();

