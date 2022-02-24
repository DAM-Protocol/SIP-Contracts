// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import { ISuperToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

interface IdHedgeCore {
    event EmergencyWithdraw(address _token);
    event CoreDeactivated(string _message);
    event CoreReactivated(string _message);
    event StreamCreated(ISuperToken _superToken, address _user);
    event StreamUpdated(ISuperToken _superToken, address _user);
    event StreamTerminated(ISuperToken _superToken, address _user);

    function dHedgeDeposit(address _token) external;
    function emergencyCloseStream(ISuperToken _superToken, address _user) external;
    function checkCoreActive() external view returns(bool);
    function getLatestDistIndex() external view returns (uint32);
    function getTokenDistIndex(address _token)
        external
        view
        returns (bool, uint32);
    function calcUserUninvested(address _user, address _token)
        external
        view
        returns (uint256);
    function requireUpkeep() external view returns (bool, address);
}