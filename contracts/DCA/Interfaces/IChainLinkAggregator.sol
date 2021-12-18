//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

interface IChainLinkAggregator {
    function getPrice(address _token1, address _token2) external view returns (int256);
}
