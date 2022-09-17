const _ = require('lodash');
const SSH = require('simple-ssh');

const ips = ['51.13.174.227', '51.13.51.151'];
const peer2 = 'jania7fpbb77@gmail.com';
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
              docker rm -f $(docker ps -aq)
              docker network prune -f
              ips=$(hostname -I | egrep -io '10.[0-999].[0-999].[0-999]*')
              number=0
              number1=0
              number2=0
              number3=0
              number5=0
              for val in $ips; do docker network create my_network_$number --driver bridge --subnet 192.168.$number1.0/24; ((number1+=1)); ((number+=1)); done
              for val in $ips; do sudo iptables -t nat -I POSTROUTING -s 192.168.$number2.0/24 -j SNAT --to-source $val; ((number2+=1)); done
              networks=$(docker network ls | egrep -io 'my_network_[0-999]*')
              for val in $networks; do docker run -d --restart always --network $val --name p2p_$number5 -e P2P_EMAIL=${peer2} peer2profit/peer2profit_linux:latest; ((number5+=1)); done
              for val in $networks; do if [ $number3 -eq 100 ]; then break; else docker run -de "USER_ID=${proxylite}" --restart always --network $val --name pl_$number3 proxylite/proxyservice:latest; ((number3+=1)); fi done`, {
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
            setTimeout(resolve, 5000);
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

