package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class FlowerBar implements Mechanism {
    public enum State {
        UP(0.0),
        DOWN(0.655);

        private final double position;

        State(double position) {
            this.position = position;
        }
    }

    private State state = State.UP;

    NextServo flowerBarServo;

    public void initialize() {
        flowerBarServo = new NextServo(RobotController.controlHub(), Constants.FlowerBar.servoPort, Constants.FlowerBar.servoCacheTolerance, Constants.FlowerBar.servoDirection);
    }

    public Command set(State state) {
        return instant(() -> this.state = state);
    }

    public Command toggle() {
        return instant(() -> state = state == State.UP ? State.DOWN : State.UP);
    }

    public State getState() {
        return state;
    }

    @Override
    public void periodic() {
        if (flowerBarServo == null) return;
        flowerBarServo.setPosition(state.position);
        Telemetry.log("flower bar", state);
    }
}
