package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.tuning.autotune.Procedure;
import com.pedropathing.tuning.autotune.Tuner;

import org.firstinspires.ftc.teamcode.util.procedures.ForesightTuner;
import org.firstinspires.ftc.teamcode.util.procedures.MecanumTuner;
import org.firstinspires.ftc.teamcode.util.procedures.PinpointTuner;
import org.firstinspires.ftc.teamcode.util.procedures.Tests;

public class Tuning {
    @Tuner
    public static Procedure mecanumTuner() {
        return new MecanumTuner();
    }

    @Tuner
    public static Procedure pinpointTuner() {
        return new PinpointTuner();
    }

    @Tuner
    public static Procedure tests() {
        return new Tests(Constants::drivetrain, Constants::localizer, Constants::algorithm);
    }

    @Tuner
    public static Procedure foresightTuner() {
        return new ForesightTuner(Constants::localizer, Constants::drivetrain);
    }
}
