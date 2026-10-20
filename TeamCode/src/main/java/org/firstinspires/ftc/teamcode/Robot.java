package org.firstinspires.ftc.teamcode;

import androidx.annotation.NonNull;

import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.commands.Commands;
import com.pedropathing.ivy.groups.Groups;
import com.qualcomm.robotcore.hardware.Gamepad;

import org.firstinspires.ftc.teamcode.subsystems.Drivetrain;
import org.firstinspires.ftc.teamcode.subsystems.Intake;
import org.firstinspires.ftc.teamcode.subsystems.Turret;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.NextRobot;
import dev.nextftc.robot.triggers.CommandGamepad;

public class Robot implements NextRobot {
    public enum State {
        IDLE,
        INTAKE
    }

    public final Intake intake = new Intake();
    public final Turret turret = new Turret();
    public final Drivetrain drivetrain = new Drivetrain();

    private State state = State.IDLE;

    private Command stateCommand(State target) {
        switch (target) {
            case IDLE:
                return Groups.sequential(
                        intake.set(Intake.State.OFF));
            case INTAKE:
                return Groups.sequential(
                        intake.set(Intake.State.INTAKE));
            default:
                throw new IllegalStateException("No command for state " + target);
        }
    }

    public void configureBindings(Gamepad gamepad, Alliance alliance) {
        CommandGamepad controller = new CommandGamepad(gamepad);

        controller.leftBumper()
                .onTrue(set(State.INTAKE))
                .onFalse(set(State.IDLE));

        controller.rightBumper()
                .onTrue(drivetrain.setSpeed(Constants.Drivetrain.slowSpeed))
                .onFalse(drivetrain.setSpeed(1.0));

        controller.x().onTrue(drivetrain.resetFieldCentric(alliance));
        controller.a().onTrue(drivetrain.resetPose(Constants.Drivetrain.resetPose));

        drivetrain.drive(gamepad, alliance).schedule();
    }

    public State getState() {
        return state;
    }

    public Command set(State target) {
        return Groups.sequential(
                Commands.instant(() -> state = target).requiring(this),
                stateCommand(target)
        );
    }

    @Override
    public void periodic() {}

    @NonNull
    @Override
    public Set<Mechanism> getMechanisms() {
        return new LinkedHashSet<>(Arrays.asList(drivetrain, intake, turret));
    }
}
