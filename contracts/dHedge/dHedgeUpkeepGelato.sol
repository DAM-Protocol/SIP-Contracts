// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {IPoolLogic} from "./Interfaces/IdHedge.sol";
import {IdHedgeCore, IdHedgeUpkeep} from "./Interfaces/ISuperdHedge.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

/**
 * @title dHedge upkeep contract
 * @author rashtrakoff
 * @dev Resolver contract for keepers
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable not-rely-on-time
// solhint-disable reason-string
// solhint-disable-next-line contract-name-camelcase
contract dHedgeUpkeepGelato is Ownable, IdHedgeUpkeep {
    struct ContractStatus {
        bool init;
        bool paused;
        uint256 lastExecuted;
    }

    uint256 public allowedInterval;
    address private constant POKE_ME =
        0x527a819db1eb0e34426297b03bae11F2f8B3A19E;
    address[] private contracts;
    mapping(address => ContractStatus) private upkeepSet;

    /// @dev Add a core contract for upkeep
    /// @param _contract Address of the core contract
    function addContract(address _contract) external {
        _onlyOwner(msg.sender);
        require(_isContract(_contract), "dHedgeUpkeep: Not a contract");
        require(
            !upkeepSet[_contract].init,
            "dHedgeUpkeep: Contract already initialized"
        );

        upkeepSet[_contract].init = true;
        contracts.push(_contract);

        emit CoreAdded(_contract);
    }

    /// @dev Pauses a core contract from upkeep services
    /// @param _contract Address of the core contract
    function pauseContract(address _contract) external {
        _onlyOwner(msg.sender);
        require(
            !upkeepSet[_contract].paused,
            "dHedgeUpkeep: Contract already paused"
        );

        upkeepSet[_contract].paused = true;

        emit CorePaused(_contract);
    }

    /// @dev Unpauses a core contract from upkeep services
    /// @param _contract Address of the core contract
    function unPauseContract(address _contract) external {
        _onlyOwner(msg.sender);
        require(
            upkeepSet[_contract].paused,
            "dHedgeUpkeep: Contract already unpaused"
        );

        upkeepSet[_contract].paused = false;

        emit CoreUnPaused(_contract);
    }

    /// @dev Removes a core contract from upkeep services
    /// @param _contract Address of the core contract
    function removeContract(address _contract) external {
        _onlyOwner(msg.sender);
        require(
            upkeepSet[_contract].init,
            "dHedgeUpkeep: Contract not initialized"
        );

        delete upkeepSet[_contract];

        emit CoreRemoved(_contract);
    }

    /// @dev Modifies accepted duration between token deposits for a pool
    /// @param _duration Acceptable difference between previous deposit and current deposit
    function modifyInterval(uint256 _duration) external {
        _onlyOwner(msg.sender);
        allowedInterval = _duration;
    }

    /// @dev Calls deposit function in a core contract. Should be used by keepers.
    /// @param _contract Address of the core contract
    /// @param _depositToken Address of the token to be deposited
    function performUpkeep(address _contract, address _depositToken)
        external
        override
    {
        if (
            block.timestamp - upkeepSet[_contract].lastExecuted <=
            allowedInterval
        ) {
            try IdHedgeCore(_contract).dHedgeDeposit(_depositToken) {
                upkeepSet[_contract].lastExecuted = block.timestamp;

                emit DepositSuccess(_contract, _depositToken);
            } catch (bytes memory _err) {
                upkeepSet[_contract].paused = true;

                emit DepositFailed(_contract, _depositToken, _err);
            }
        }
    }

    /// @dev Function which checks if any of the registered core contracts require upkeep
    function checkUpkeep()
        external
        view
        override
        returns (bool _canExec, bytes memory _execPayload)
    {
        for (uint256 i = 0; i < contracts.length; ++i) {
            address _contract = contracts[i];
            try IdHedgeCore(_contract).requireUpkeep() returns (
                bool _result,
                address _token
            ) {
                _canExec = _result;

                _execPayload = abi.encodeWithSelector(
                    IdHedgeUpkeep.performUpkeep.selector,
                    _contract,
                    _token
                );

                console.log("Check successful for contract %s", _contract);

                if (_canExec) break;
            } catch (bytes memory error) {
                // To allow debugging using Tenderly dashboard
                console.log(
                    "Error encountered for contract %s with error: ",
                    _contract
                );
                console.logBytes(error);
            }
        }
    }

    /// @dev Checks if a given address is a contract or not
    /// @param account Address of the account
    function _isContract(address account) internal view returns (bool) {
        // This method relies on extcodesize, which returns 0 for contracts in
        // construction, since the code is only stored at the end of the
        // constructor execution.

        /* solhint-disable no-inline-assembly */
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
        /* solhint-enable no-inline-assembly */
    }

    function _onlyOwner(address _user) internal view {
        require(_user == owner(), "dHedgeUpkeepGelato: Not the owner");
    }
}
