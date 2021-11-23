//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./Interfaces/IDCA.sol";

contract Resolver {
    IDCA private DCAContract;
    uint256 private startIndex;

    constructor(address _DCAContract, uint256 _startIndex) {
        DCAContract = IDCA(_DCAContract);
        startIndex = _startIndex;
    }

    function resolve() external view returns (bool canExec, bytes memory execPayload) {
        return DCAContract.checkTaskBatch(startIndex);
    }
}
