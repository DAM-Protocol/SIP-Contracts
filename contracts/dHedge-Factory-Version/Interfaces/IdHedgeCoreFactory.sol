// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.10;

interface IdHedgeCoreFactory {
    event CoreCreated(address newCore, address pool, address poolSuperToken);
    event ImplementationChanged(address newImplementation, string message);
    event FeeRateChanged(uint32 newFeeRate);
    event MultiSigAddressChanged(address newMultiSig);

    function multiSig() external view returns (address);

    function defaultFeeRate() external view returns (uint32);
}
