const bigNum = web3.utils.toBN;

// const ConvertLib = artifacts.require("ConvertLib");
const Remittance = artifacts.require("Remittance");
const initialFee = bigNum(1e16);

module.exports = function(deployer) {
  // deployer.deploy(ConvertLib);
  // deployer.link(ConvertLib, MetaCoin);
  deployer.deploy(Remittance, initialFee);
};
