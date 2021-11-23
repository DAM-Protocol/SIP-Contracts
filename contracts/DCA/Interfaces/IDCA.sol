//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

interface IDCA {
    function checkTaskBatch(uint256 _index) external view returns (bool canExec, bytes memory execPayload);
}
