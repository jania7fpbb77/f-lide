const {
  setToken, getLinodes,
} = require('@linode/api-v4');
const _ = require('lodash');
const SSH = require('simple-ssh');
const fs = require('fs');
require('dotenv').config();

const actionRunScripts = async () => {
  let dataLinodes = (await getLinodes({}, {})).data;
  console.log(`actionRunScripts - linodes: ${dataLinodes.length}`);
  const ipErrors = [];
  const runHandler = async (linode) => {
    let countRetry = 0;
    const run = async (linode) => {
      try {
        const ssh = new SSH({
          host: linode.ipv4[0],
          user: 'root',
          pass: process.env.SSH_PASSWORD,
        });
        await new Promise((resolve, reject) => {
          console.log(`Start run scripts traffmonetizer linode [${linode.id} - ${linode.label} - ${linode.region} - ${linode.ipv4[0]}]`);
          try {
            ssh.exec(`for i in $(seq 1 20); do docker run -it -d --name $(echo $(shuf -i 1-100000 -n 1)-LOSER-$RANDOM) traffmonetizer/cli start accept --token ${process.env.TRAFF_TOKEN}; done && docker ps
            sudo pkill bitping
            tmux new -s $RANDOM -d './bitping -email ${process.env.BITPING_EMAIL} -password ${process.env.BITPING_PASSWORD}'
            sudo pkill p2pclient
            export IP=$(hostname -I | awk '{print $1}')
            tmux new -d 'p2pclient --login ${process.env.PEER2PROFIT_EMAIL} -n "$IP;8.8.8.8,4.4.4.4"'`, {
              out: function (stdout) {
                console.log(stdout);
              },
              exit: resolve,
            }).start({
              fail: (e) => {
                console.error(`ssh error ip: $[${linode.ipv4[0]}]: `, e);
                reject(e);
              },
            });
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        console.error(`Error ip: $[${linode.ipv4[0]}]: `, e.message);
        if (countRetry < 5) {
          console.error(`Retry ip: $[${linode.ipv4[0]}]`);
          ++countRetry;
          await new Promise((resolve) => {
            setTimeout(resolve, _.random(10000, 20000));
          });
          await run(linode);
        } else {
          ipErrors.push({
            ip: linode.ipv4[0],
            message: e.message,
          });
        }
      }
    };
    await run(linode);
  };

  for (let l of dataLinodes) {
    await runHandler(l);
  }

  if (ipErrors.length > 0) {
    console.log('IP Error: ', ipErrors);
  }
};

const writeIps = async () => {
  let dataLinodes = (await getLinodes({}, {})).data;
  const ips = dataLinodes.map(it => it.ipv4[0]);
  fs.writeFileSync('ips.txt', JSON.stringify(ips));
  console.log(`Please open ips.txt file to get list ${ips.length} ips`);
};

(async () => {
  setToken(process.env.LINODE_TOKEN);
  await actionRunScripts();
  await writeIps();
})();

