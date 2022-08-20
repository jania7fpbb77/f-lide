const _ = require('lodash');
const SSH = require('simple-ssh');

const ips = [];
const traff = 'OITpFZ6P778NjyZkRTnIMNSj+UEF6xwA5DzBAuVhLT4=';
const proxylite = '431219';

const ssh_user = 'ubuntu';
const ssh_pass = 'Ht@1234-1234';

const actionRunScripts = async () => {
  const ipErrors = [];
  const runHandler = async (ip) => {
    let countRetry = 0;
    const run = async (ip) => {
      try {
        const ssh = new SSH({
          host: ip,
          user: ssh_user,
          pass: ssh_pass,
        });
        await new Promise((resolve, reject) => {
          console.log(`Start run scripts [${ip}]`);
          try {
            ssh.exec(`
              docker rm -f $(docker ps -a -q  --filter ancestor=traffmonetizer/cli)
              for i in $(seq 0 9); do docker run -d --restart always --network my_network_$i --name tm_$i traffmonetizer/cli start accept --token ${traff}; done`, {
              out: function (stdout) {
                console.log(stdout);
              },
              exit: resolve,
            }).start({
              fail: (e) => {
                console.error(`ssh error ip: [${ip}]: `, e);
                reject(e);
              },
            });
            //
            // ssh.exec(`
            //   docker rm -f $(docker ps -a -q  --filter ancestor=proxylite/proxyservice:latest)
            //   for i in $(seq 0 9); do docker run -de "USER_ID=${proxylite}" --restart always --network my_network_$i --name pl_$i proxylite/proxyservice:latest; done`, {
            //   out: function (stdout) {
            //     console.log(stdout);
            //   },
            //   exit: resolve,
            // }).start({
            //   fail: (e) => {
            //     console.error(`ssh error ip: [${ip}]: `, e);
            //     reject(e);
            //   },
            // });
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        console.error(`Error ip: [${ip}]: `, e.message);
        if (countRetry < 5) {
          console.error(`Retry ip: [${ip}]`);
          ++countRetry;
          await new Promise((resolve) => {
            setTimeout(resolve, _.random(5000, 10000));
          });
          await run(ip);
        } else {
          ipErrors.push({
            ip: ip,
            message: e.message,
          });
        }
      }
    }
    await run(ip);
  };

  for (let l of ips) {
    await runHandler(l);
  }

  if (ipErrors.length > 0) {
    console.log('IP Error: ', ipErrors);
  }
};

(async () => {
  await actionRunScripts();
})();

