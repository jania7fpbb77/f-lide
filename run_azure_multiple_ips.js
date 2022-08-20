const _ = require('lodash');
const SSH = require('simple-ssh');

const ips = [];
const traff = 'uolZPRekNn+PgkJmdg/wBqlujIR2nHSCTXYApiWBIdI=';
const peer2 = 'kojinyoji@gmail.com';
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
            ssh.exec(`sudo apt update -y
              sudo apt install docker.io -y
              sudo chmod 777 /var/run/docker.sock
              for i in $(seq 0 9); do docker network create my_network_$i --driver bridge --subnet 192.168.3$i.0/24; done
              ips=$(hostname -I | grep -i 10. | awk '{print $1, $2, $3, $4, $5, $6, $7, $8, $9, $10}')
              number=0
              for val in $ips; do sudo iptables -t nat -I POSTROUTING -s 192.168.3$number.0/24 -j SNAT --to-source $val; ((number+=1)); done
              for i in $(seq 0 9); do docker run -de "USER_ID=${proxylite}" --restart always --network my_network_$i --name pl_$i proxylite/proxyservice:latest; done
              for i in $(seq 0 9); do docker run -d --restart always --network my_network_$i --name tm_$i traffmonetizer/cli start accept --token ${traff}; done
              for i in $(seq 0 9); do docker run -d --restart always --network my_network_$i --name p2p_$i -e P2P_EMAIL=${peer2} peer2profit/peer2profit_linux:latest; done`, {
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

