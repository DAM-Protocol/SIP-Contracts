// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

interface IdHedgeCoreFactory {
    event CoreCreated(address _newCore, address _pool, address _poolSuperToken);
    event ImplementationChanged(address _newImplementation, string _message);
    event FeeRateChanged(uint32 _newFeeRate);
    event DAOAddressChanged(address _newDAO);

    function dao() external view returns (address);

    function defaultFeeRate() external view returns (uint32);
}
