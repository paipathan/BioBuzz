package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class FlowerBar implements Mechanism {
    private State state = State.UP;
    public enum State {
        UP,
        DOWN
    }

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
        switch (state) {
            case UP:
                flowerBarServo.setPosition(Constants.FlowerBar.upPosition);
                break;
            case DOWN:
                flowerBarServo.setPosition(Constants.FlowerBar.downPosition);
                break;
        }
        Telemetry.log("flower bar", state);
    }
}
