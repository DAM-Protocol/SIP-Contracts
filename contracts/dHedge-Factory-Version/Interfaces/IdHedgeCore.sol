// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.10;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

interface IdHedgeCore {
    event EmergencyWithdraw(address token);
    event CoreDeactivated(string message);
    event CoreReactivated(string message);
    event StreamModified(ISuperToken superToken, address user);

    function dHedgeDeposit(address _token) external;

    function emergencyCloseStream(ISuperToken _superToken, address _user)
        external;

    function checkCoreActive() external view returns (bool);

    function getUserDistIndex(address _user, address _token)
        external
        view
        returns (uint32);

    function getTokenDistIndices(address _token)
        external
        view
        returns (
            uint32,
            uint32,
            uint32,
            uint32
        );

    function getSubscriptionIndex(
        address _user,
        address _underlyingToken,
        uint8 _streamAction
    ) external view returns (uint32);

    function calcUserUninvested(
        address _user,
        ISuperToken _superToken,
        uint64 _delay
    ) external view returns (uint256);

    function calcBufferTransferAmount(
        address _user,
        ISuperToken _superToken,
        uint8 _streamAction,
        uint64 _delay,
        int96 _flowRate
    ) external view returns (uint256 _transferAmount, bool _isTaken);

    function requireUpkeep() external view returns (address);
}
