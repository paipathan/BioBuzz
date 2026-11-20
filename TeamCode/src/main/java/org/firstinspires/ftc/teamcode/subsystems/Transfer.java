package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.hardware.actuators.NextServo;
import dev.nextftc.robot.Mechanism;

public class Transfer implements Mechanism {
    public enum State {
        OFF(0.0, Constants.Transfer.stopperClosedPosition),
        LOAD(1.0, Constants.Transfer.stopperClosedPosition),
        OPEN(0.0, Constants.Transfer.stopperOpenPosition),
        FEED(1.0, Constants.Transfer.stopperOpenPosition),
        UNJAM(-1.0, Constants.Transfer.stopperClosedPosition);

        private final double power;
        private final double stopperPosition;

        State(double power, double stopperPosition) {
            this.power = power;
            this.stopperPosition = stopperPosition;
        }
    }

    private State state = State.OFF;

    NextMotor transferMotor1;
    NextServo stopperServo;

    public void initialize() {
        if (transferMotor1 == null) {
            transferMotor1 = new NextMotor(RobotController.controlHub(), Constants.Transfer.transferMotorPort1);
        }
        transferMotor1.setDirection(Constants.Transfer.transferMotorDirection1);
        transferMotor1.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);
        Utilities.syncStoppedMotor(transferMotor1);
        // New every init: a reused NextServo would skip re-sending "closed" if that was its last command,
        // and the servo stays unpowered after the previous opmode stopped.
        stopperServo = new NextServo(RobotController.controlHub(), Constants.Transfer.stopperServoPort, Constants.Transfer.stopperServoCacheTolerance, Constants.Transfer.stopperServoDirection);
        state = State.OFF;
    }

    public Command set(State state) {
        return instant(() -> this.state = state);
    }

    public State getState() {
        return state;
    }

    @Override
    public void periodic() {
        if (transferMotor1 == null) return;
        transferMotor1.setThrottle(state.power);
        if (stopperServo != null) {
            stopperServo.setPosition(state.stopperPosition);
        }
    }
}
