const {
  setToken, getLinode, getLinodes, createLinode, cloneLinode, linodeBoot, deleteLinode,
} = require('@linode/api-v4');
const _ = require('lodash');
const interval = require('interval-promise');
const SSH = require('simple-ssh');
const fs = require('fs');
require('dotenv').config();

const regions = ['ap-northeast', 'ap-south', 'ap-southeast', 'ap-west'];

const getRegionsRandom = (ignoreRegion = []) => {
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

const cloneLinodeHandler = async (linode, wait = 2000) => {
  try {
    await new Promise((resolve) => {
      setTimeout(resolve, wait + _.random(1000, 3000));
    });
    const newLinode = await cloneLinode(linode.id, {
      type: linode.type,
      region: linode.region,
      label: 'clone_fuck_' + new Date().getTime(),
    });
    console.log(`Clone Linode [${newLinode.id} - ${linode.label}] created`);
    return await new Promise(async (resolve) => {
      await interval(async (iterationNumber, stop) => {
        try {
          const rs = await getLinode(newLinode.id);
          console.log(`Checking clone linode [${newLinode.id} - ${newLinode.label} - ${newLinode.region} - ${newLinode.ipv4[0]}] status is ${rs.status}`);
          if (rs.status === 'offline' && iterationNumber >= 5) {
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
      }, 8000);
    });
  } catch (e) {
    console.log('[cloneLinodeHandler] ignore error: ', e.message);
    console.log('[cloneLinodeHandler] Retrying...');
    await new Promise((resolve) => {
      setTimeout(resolve, _.random(3000, 5000));
    });
    await cloneLinodeHandler(linode, wait);
  }
};

const actionCloneLinode = async (linode, max) => {
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
    await Promise.all(list.map(async (l) => await cloneLinodeHandler(l, _.random(1000, 2000))));
  }));

  dataLinodes = (await getLinodes({}, { region: linode.region })).data;
  if (dataLinodes.length < max) {
    return await actionCloneLinode(linode, max);
  } else {
    console.log(`Done clone for region [${linode.region}]`);
    return Promise.resolve();
  }
};

const createLinodeHandler = async (ignoreRegion) => {
  try {
    const region = _.sample(getRegionsRandom(ignoreRegion));
    ignoreRegion.push(region);
    const linode = await createLinode({
      type: 'g6-nanode-1',
      image: 'linode/ubuntu22.04',
      region: region,
      root_pass: process.env.SSH_PASSWORD,
      label: 'fuck_' + new Date().getTime(),
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
      }, 5000);
    });
  } catch (e) {
    console.log('ignore error: ', e.message);
    console.log('[createLinodeHandler] Retrying... ');
    await new Promise((resolve) => {
      setTimeout(resolve, _.random(3000, 5000));
    });
    return await createLinodeHandler(ignoreRegion);
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
    try {
      const ssh = new SSH({
        host: linode.ipv4[0],
        user: 'root',
        pass: process.env.SSH_PASSWORD,
      });
      await new Promise((resolve, reject) => {
        console.log(`Start run scripts traffmonetizer linode [${linode.id} - ${linode.label} - ${linode.region} - ${linode.ipv4[0]}]`);
        ssh.exec(`for i in $(seq 1 10); do docker run -it -d --name $(echo $(shuf -i 1-100000 -n 1)-LOSER-$RANDOM) traffmonetizer/cli start accept --token ${process.env.TRAFF_TOKEN}; done && docker ps`, {
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
      });
      await new Promise((resolve, reject) => {
        console.log(`Start run scripts peer2profit linode [${linode.id} - ${linode.label} - ${linode.region} - ${linode.ipv4[0]}]`);
        ssh.exec(`sudo pkill p2pclient
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
      });
    } catch (e) {
      ipErrors.push({
        ip: linode.ipv4[0],
        message: e.message,
      });
      console.error(`Retry error ip: $[${linode.ipv4[0]}]: `, e.message);
    }
  };

  for (let l of dataLinodes) {
    await runHandler(l);
  }

  if (ipErrors.length > 0) {
    console.log('IP Error: ', ipErrors);
  }
};

const cloneAndExecScripts = async (linode, max, numberRegions) => {
  const installBaseScripts = async () => {
    const ssh = new SSH({
      host: linode.ipv4[0],
      user: 'root',
      pass: process.env.SSH_PASSWORD,
    });

    await new Promise((resolve, reject) => {
      console.log('Install base scripts');
      ssh.exec('sudo apt update -y && sudo apt install docker.io -y && sudo chmod 777 /var/run/docker.sock && docker pull traffmonetizer/cli && wget https://updates.peer2profit.app/p2pclient_0.60_amd64.deb && sudo apt install ./p2pclient_0.60_amd64.deb', {
        out: function (stdout) {
          console.log(stdout);
        },
        exit: resolve,
      }).start({
        fail: reject,
      });
    });
  }

  try {
    await installBaseScripts();
  } catch (e) {
    console.log('[installBaseScripts] ignore error: ', e.message);
    console.log('[installBaseScripts] Retrying...');
    await new Promise((resolve) => {
      setTimeout(resolve, _.random(3000, 5000));
    });
    await installBaseScripts();
  }

  await actionCloneLinode(linode, _.ceil(max / numberRegions));
  console.log(`Wait 30s for ssh ready`);
  await new Promise((resolve) => {
    setTimeout(resolve, 30000);
  });
  await actionRunScripts(linode.region);
};

const allInOne = async (max, numberRegions) => {
  let ignoreRegion = [];
  const promises = _.times(numberRegions, async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, _.random(1000, 3000));
    });
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
  fs.writeFileSync("ips.txt", JSON.stringify(dataLinodes.map(it => it.ipv4[0])));
  console.log('Please open ips.txt file to get list ips')
}

(async () => {
  let max = process.env.LINODE_LIMIT;
  let numberRegions = process.env.MAX_REGIONS;
  setToken(process.env.LINODE_TOKEN);

  await allInOne(max, numberRegions);
  await writeIps();

  // const linode = await getLinode('36972640');
  // await cloneAndExecScripts(linode, max, numberRegions);

  // await deleteAllLinodes();
})();

