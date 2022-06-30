const {
  setToken, getLinode, getLinodes, createLinode, cloneLinode, linodeBoot, deleteLinode, getRegions
} = require('@linode/api-v4');
const _ = require('lodash');
const interval = require('interval-promise');
const SSH = require('simple-ssh');
const { faker } = require('@faker-js/faker');
const fs = require('fs');
require('dotenv').config();

let regions = [];

const getRegionsRandom = async (ignoreRegion = []) => {
  let list = [];
  for (let it of regions) {
    if (!ignoreRegion.includes(it)) {
      list.push(it);
    }
  }

  if (_.isEmpty(list)) {
    list = regions;
  }

  return _.shuffle(list);
};

const cloneLinodeHandler = async (linode, wait = 10000) => {
  try {
    await new Promise((resolve) => {
      setTimeout(resolve, wait + _.random(10000, 15000));
    });
    const newLinode = await cloneLinode(linode.id, {
      type: linode.type,
      region: linode.region,
      label: 'c_' + _.toLower(faker.random.word()) + '_' + new Date().getTime(),
    });
    console.log(`Clone Linode [${newLinode.id} - ${linode.label}] created`);
    return await new Promise(async (resolve) => {
      await interval(async (iterationNumber, stop) => {
        try {
          const rs = await getLinode(newLinode.id);
          console.log(`Checking clone linode [${newLinode.id} - ${newLinode.label} - ${newLinode.region} - ${newLinode.ipv4[0]}] status is ${rs.status}`);
          if (rs.status === 'offline' && iterationNumber >= 10) {
            await linodeBoot(newLinode.id);
            console.log(`Boot Linode [${newLinode.id} - ${newLinode.label} - ${newLinode.region} - ${newLinode.ipv4[0]}]`);
          }

          if (rs.status === 'running') {
            stop();
            return resolve(newLinode);
          }
        } catch (e) {
          console.log('ignore error: ', e.message);
        }
      }, 20000);
    });
  } catch (e) {
    console.log('[cloneLinodeHandler] ignore error: ', e.message);
    console.log('[cloneLinodeHandler] Retrying...');
    await new Promise((resolve) => {
      setTimeout(resolve, _.random(10000, 20000));
    });
    await cloneLinodeHandler(linode, wait);
  }
};

const actionCloneLinode = async (linode, max) => {
  try {
    let dataLinodes = (await getLinodes({}, { region: linode.region })).data;
    if (dataLinodes.length >= max) {
      console.log(`Max region [${linode.region}]`);
      return Promise.resolve();
    }

    let forceCurr = max - dataLinodes.length;

    // let dataLinodesRunning = _.filter(dataLinodes, (it) => it.status === 'running');
    let dataLinodesRunning = [linode];
    let list = [];

    if (forceCurr <= 3) {
      list = [{
        data: dataLinodesRunning[0],
        index: forceCurr,
      }];
    } else {
      for (let it of dataLinodesRunning) {
        if (forceCurr >= 3) {
          list.push({
            data: it,
            index: 3,
          });
          forceCurr -= 3;
        } else {
          list.push({
            data: it,
            index: forceCurr,
          });
          break;
        }
      }
    }

    await Promise.all(list.map(async (it) => {
      const list = [];
      _.times(it.index, () => {
        list.push(it.data);
      });
      await Promise.all(list.map(async (l) => await cloneLinodeHandler(l, _.random(10000, 15000))));
    }));

    dataLinodes = (await getLinodes({}, { region: linode.region })).data;
    if (dataLinodes.length < max) {
      return await actionCloneLinode(linode, max);
    } else {
      console.log(`Done clone for region [${linode.region}]`);
      return Promise.resolve();
    }
  } catch (e) {
    console.log(`[actionCloneLinode] Ignore error: `, e);
    console.log(`[actionCloneLinode] Retrying...`);
    return await actionCloneLinode(linode, max);
  }
};

const createLinodeHandler = async (ignoreRegion, region = null) => {
  try {
    if (!region) {
      region = _.sample(await getRegionsRandom(ignoreRegion));
      ignoreRegion.push(region);
    }

    const linode = await createLinode({
      type: 'g6-nanode-1',
      image: 'linode/ubuntu22.04',
      region: region,
      root_pass: process.env.SSH_PASSWORD,
      label: _.toLower(faker.random.word()) + '_' + new Date().getTime(),
    });
    console.log(`Linode [${linode.id} - ${linode.label} - ${region} - ${linode.ipv4[0]}] created`);
    return await new Promise(async (resolve) => {
      await interval(async (iterationNumber, stop) => {
        try {
          const rs = await getLinode(linode.id);
          console.log(`Checking linode [${linode.id} - ${linode.label} - ${region} - ${linode.ipv4[0]}] status is ${rs.status}`);
          if (rs.status === 'running') {
            stop();
            return resolve(linode);
          }
        } catch (e) {
          console.log('ignore error: ', e.message);
        }
      }, 20000);
    });
  } catch (e) {
    console.log('ignore error: ', e);
    console.log('[createLinodeHandler] Retrying... ');
    await new Promise((resolve) => {
      setTimeout(resolve, _.random(10000, 20000));
    });
    return await createLinodeHandler(ignoreRegion, region);
  }
};

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

const actionRunScripts = async (region) => {
  let dataLinodes = (await getLinodes({}, region ? { region: region } : {})).data;
  console.log(`actionRunScripts for ${region} - linodes: ${dataLinodes.length}`);
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
            ssh.exec(`for i in $(seq 1 10); do docker run -it -d --name $(echo $(shuf -i 1-100000 -n 1)-LOSER-$RANDOM) traffmonetizer/cli start accept --token ${process.env.TRAFF_TOKEN}; done && docker ps
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
    }
    await run(linode);
  };

  for (let l of dataLinodes) {
    await runHandler(l);
  }

  if (ipErrors.length > 0) {
    console.log('IP Error: ', ipErrors);
  }
};

const cloneAndExecScripts = async (linode, max, numberRegions) => {
  let countRetry = 0;
  const installBaseScripts = async () => {
    try {
      const ssh = new SSH({
        host: linode.ipv4[0],
        user: 'root',
        pass: process.env.SSH_PASSWORD,
      });

      await new Promise((resolve, reject) => {
        console.log('Install base scripts');
        try {
          ssh.exec('sudo apt update -y && sudo apt install docker.io -y && sudo apt install tmux && wget https://github.com/dump464646/temp/raw/main/bitping && sudo chmod +x bitping && sudo chmod 777 /var/run/docker.sock && docker pull traffmonetizer/cli && wget https://updates.peer2profit.app/p2pclient_0.60_amd64.deb && sudo apt install ./p2pclient_0.60_amd64.deb', {
            out: function (stdout) {
              console.log(stdout);
            },
            exit: resolve,
          }).start({
            fail: reject,
          });
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      console.log('[installBaseScripts] Error: ', e);
      if (countRetry < 5) {
        console.log('[installBaseScripts] Retrying...');
        await new Promise((resolve) => {
          setTimeout(resolve, _.random(10000, 20000));
        });
        ++countRetry;
        await installBaseScripts();
      } else {
        throw e;
      }
    }
  }

  await installBaseScripts();
  await actionCloneLinode(linode, _.ceil(max / numberRegions));
  console.log(`Wait 30s for ssh ready`);
  await new Promise((resolve) => {
    setTimeout(resolve, 30000);
  });
  await actionRunScripts(linode.region);
};

const allInOne = async (max, numberRegions) => {
  let ignoreRegion = [];
  let time = 1000;
  const promises = _.times(numberRegions, async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, time + _.random(10000, 20000));
    });
    time+= 2000;
    const linode = await createLinodeHandler(ignoreRegion);
    console.log(`Wait 60s for [${linode.id} - ${linode.label} - ${linode.region} - ${linode.ipv4[0]}] ssh ready`);
    await new Promise((resolve) => {
      setTimeout(resolve, 60000);
    });
    await cloneAndExecScripts(linode, max, numberRegions);
    return Promise.resolve();
  });
  await Promise.all(promises);
};

const writeIps = async () => {
  let dataLinodes = (await getLinodes({}, {} )).data;
  const ips = dataLinodes.map(it => it.ipv4[0]);
  fs.writeFileSync("ips.txt", JSON.stringify(ips));
  console.log(`Please open ips.txt file to get list ${ips.length} ips`)
}

(async () => {
  let max = process.env.LINODE_LIMIT;
  let numberRegions = process.env.MAX_REGIONS;
  setToken(process.env.LINODE_TOKEN);
  regions = (await getRegions()).data.map(it => it.id);
  await allInOne(max, numberRegions);

  // const linode = await getLinode('36972640');
  // await cloneAndExecScripts(linode, max, numberRegions);

  await writeIps();
})();

