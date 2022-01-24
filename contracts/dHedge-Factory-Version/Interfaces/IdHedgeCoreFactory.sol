// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

interface IdHedgeCoreFactory {
    function owner() external view returns(address);
    function defaultFeeRate() external view returns(uint32);
}